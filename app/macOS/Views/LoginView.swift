//
//  LoginView.swift
//  Bap macOS
//
//  Sign in view with Magic Link, Google, and Apple authentication
//

import SwiftUI
import AuthenticationServices

struct LoginView: View {
    private var authManager = AuthManager.shared

    @State private var email = ""
    @State private var isLoading = false
    @State private var showMagicLinkSent = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 24) {
            // Logo and title
            VStack(spacing: 12) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.primary)

                Text("Welcome to Bap")
                    .font(.title)
                    .fontWeight(.bold)

                Text("Sign in to continue")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()
                .frame(height: 16)

            // Sign in options
            VStack(spacing: 12) {
                // Magic Link Section
                VStack(spacing: 8) {
                    TextField("Email address", text: $email)
                        .textFieldStyle(.roundedBorder)
                        .textContentType(.emailAddress)
                        .disabled(isLoading)

                    Button {
                        Task {
                            await sendMagicLink()
                        }
                    } label: {
                        HStack {
                            if isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle())
                                    .scaleEffect(0.7)
                            } else {
                                Image(systemName: "envelope.fill")
                            }
                            Text("Continue with Email")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(email.isEmpty || isLoading)
                }

                // Divider
                HStack {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(height: 1)
                    Text("or")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Rectangle()
                        .fill(Color.secondary.opacity(0.3))
                        .frame(height: 1)
                }
                .padding(.vertical, 4)

                // Social sign in buttons
                VStack(spacing: 8) {
                    // Sign in with Apple
                    SignInWithAppleButton(.signIn) { request in
                        request.requestedScopes = [.email, .fullName]
                    } onCompletion: { result in
                        Task {
                            await handleAppleSignIn(result: result)
                        }
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 36)

                    // Sign in with Google
                    Button {
                        Task {
                            await signInWithGoogle()
                        }
                    } label: {
                        HStack {
                            Image(systemName: "g.circle.fill")
                            Text("Continue with Google")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isLoading)
                }
            }

            // Error message
            if let error = errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(32)
        .frame(width: 320, height: 420)
        .alert("Check your email", isPresented: $showMagicLinkSent) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("We've sent a magic link to \(email). Click the link in the email to sign in.")
        }
        .onOpenURL { url in
            Task {
                await handleDeepLink(url: url)
            }
        }
    }

    // MARK: - Actions

    private func sendMagicLink() async {
        guard !email.isEmpty else { return }

        isLoading = true
        errorMessage = nil

        do {
            try await authManager.sendMagicLink(email: email)
            showMagicLinkSent = true
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    private func signInWithGoogle() async {
        isLoading = true
        errorMessage = nil

        do {
            try await authManager.signInWithGoogle()
        } catch AuthError.cancelled {
            // User cancelled
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    private func handleAppleSignIn(result: Result<ASAuthorization, Error>) async {
        isLoading = true
        errorMessage = nil

        switch result {
        case .success:
            do {
                try await authManager.signInWithApple()
            } catch AuthError.cancelled {
                // User cancelled
            } catch {
                errorMessage = error.localizedDescription
            }
        case .failure(let error):
            if (error as NSError).code != ASAuthorizationError.canceled.rawValue {
                errorMessage = error.localizedDescription
            }
        }

        isLoading = false
    }

    private func handleDeepLink(url: URL) async {
        guard url.scheme == "bap", url.host == "auth" else { return }

        isLoading = true
        errorMessage = nil

        do {
            try await authManager.handleMagicLinkCallback(url: url)
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }
}

#Preview {
    LoginView()
}
