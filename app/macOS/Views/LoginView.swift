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
                Image("BapLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

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
                        HStack(spacing: 6) {
                            if isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle())
                                    .scaleEffect(0.7)
                            } else {
                                Image(systemName: "envelope.fill")
                                    .font(.system(size: 13))
                            }
                            Text("Continue with Email")
                                .font(.system(size: 15, weight: .medium))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 32)
                    }
                    .buttonStyle(.plain)
                    .background(Color.primary)
                    .foregroundColor(Color(NSColor.windowBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
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
                    // Continue with Apple
                    Button {
                        Task {
                            await signInWithApple()
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "apple.logo")
                                .font(.system(size: 15))
                            Text("Continue with Apple")
                                .font(.system(size: 15, weight: .medium))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 32)
                    }
                    .buttonStyle(.plain)
                    .background(Color.primary)
                    .foregroundColor(Color(NSColor.windowBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .disabled(isLoading)

                    // Continue with Google
                    Button {
                        Task {
                            await signInWithGoogle()
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image("GoogleLogo")
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .frame(width: 15, height: 15)
                            Text("Continue with Google")
                                .font(.system(size: 15, weight: .medium))
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 32)
                    }
                    .buttonStyle(.plain)
                    .background(Color(NSColor.windowBackgroundColor))
                    .foregroundColor(.primary)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color.secondary.opacity(0.3), lineWidth: 1)
                    )
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

    private func signInWithApple() async {
        isLoading = true
        errorMessage = nil

        do {
            try await authManager.signInWithApple()
        } catch AuthError.cancelled {
            // User cancelled
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }
}

#Preview {
    LoginView()
}
