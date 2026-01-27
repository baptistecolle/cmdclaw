//
//  LoginView.swift
//  BapIOS
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
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 32) {
                    Spacer()
                        .frame(height: geometry.size.height * 0.1)

                    // Logo and title
                    VStack(spacing: 16) {
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                            .font(.system(size: 64))
                            .foregroundStyle(.primary)

                        Text("Welcome to Bap")
                            .font(.largeTitle)
                            .fontWeight(.bold)

                        Text("Sign in to continue")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()
                        .frame(height: 24)

                    // Sign in options
                    VStack(spacing: 16) {
                        // Magic Link Section
                        VStack(spacing: 12) {
                            TextField("Email address", text: $email)
                                .textFieldStyle(.roundedBorder)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .disabled(isLoading)

                            Button {
                                Task {
                                    await sendMagicLink()
                                }
                            } label: {
                                HStack {
                                    if isLoading {
                                        ProgressView()
                                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                            .scaleEffect(0.8)
                                    } else {
                                        Image(systemName: "envelope.fill")
                                    }
                                    Text("Continue with Email")
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(Color.primary)
                                .foregroundColor(Color(uiColor: .systemBackground))
                                .cornerRadius(10)
                            }
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

                        // Social sign in buttons
                        VStack(spacing: 12) {
                            // Sign in with Apple
                            SignInWithAppleButton(.signIn) { request in
                                request.requestedScopes = [.email, .fullName]
                            } onCompletion: { result in
                                Task {
                                    await handleAppleSignIn(result: result)
                                }
                            }
                            .signInWithAppleButtonStyle(.black)
                            .frame(height: 50)
                            .cornerRadius(10)

                            // Sign in with Google
                            Button {
                                Task {
                                    await signInWithGoogle()
                                }
                            } label: {
                                HStack {
                                    Image(systemName: "g.circle.fill")
                                        .font(.title2)
                                    Text("Continue with Google")
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(Color(uiColor: .secondarySystemBackground))
                                .foregroundColor(.primary)
                                .cornerRadius(10)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10)
                                        .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
                                )
                            }
                            .disabled(isLoading)
                        }
                    }
                    .padding(.horizontal, 24)

                    // Error message
                    if let error = errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }

                    Spacer()
                }
                .frame(minHeight: geometry.size.height)
            }
        }
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
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            errorMessage = "Unable to find window for authentication"
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            try await authManager.signInWithGoogle(presentationAnchor: window)
        } catch AuthError.cancelled {
            // User cancelled, no error message needed
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }

    private func handleAppleSignIn(result: Result<ASAuthorization, Error>) async {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            errorMessage = "Unable to find window for authentication"
            return
        }

        isLoading = true
        errorMessage = nil

        switch result {
        case .success:
            do {
                try await authManager.signInWithApple(presentationAnchor: window)
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
