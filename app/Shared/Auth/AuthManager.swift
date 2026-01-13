//
//  AuthManager.swift
//  Bap
//
//  Shared authentication manager for iOS and macOS
//

import Foundation
import AuthenticationServices
import SwiftUI

@MainActor
class AuthManager: ObservableObject {
    static let shared = AuthManager()

    @Published var isAuthenticated = false
    @Published var isLoading = true
    @Published var currentUser: AuthUser?
    @Published var errorMessage: String?

    private let baseURL: URL
    private let keychainService = "com.bap.auth"
    private let sessionTokenKey = "sessionToken"

    private init() {
        #if DEBUG
        self.baseURL = URL(string: "http://localhost:3000")!
        #else
        self.baseURL = URL(string: "https://www.heybap.com")!
        #endif

        Task {
            await checkSession()
        }
    }

    // MARK: - Session Management

    func checkSession() async {
        isLoading = true
        defer { isLoading = false }

        guard let token = getSessionToken() else {
            isAuthenticated = false
            currentUser = nil
            return
        }

        do {
            let user = try await fetchCurrentUser(token: token)
            currentUser = user
            isAuthenticated = true
        } catch {
            // Token invalid or expired
            deleteSessionToken()
            isAuthenticated = false
            currentUser = nil
        }
    }

    func signOut() async {
        do {
            if let token = getSessionToken() {
                try await revokeSession(token: token)
            }
        } catch {
            print("Error revoking session: \(error)")
        }

        deleteSessionToken()
        isAuthenticated = false
        currentUser = nil
    }

    // MARK: - Magic Link

    func sendMagicLink(email: String) async throws {
        let url = baseURL.appendingPathComponent("api/auth/magic-link")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["email": email]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw AuthError.magicLinkFailed
        }
    }

    func handleMagicLinkCallback(url: URL) async throws {
        // Extract token from callback URL
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let token = components.queryItems?.first(where: { $0.name == "token" })?.value else {
            throw AuthError.invalidCallback
        }

        // Verify the magic link token with the server
        let verifyURL = baseURL.appendingPathComponent("api/auth/magic-link/verify")
        var request = URLRequest(url: verifyURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = ["token": token]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw AuthError.invalidToken
        }

        let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
        saveSessionToken(authResponse.token)
        currentUser = authResponse.user
        isAuthenticated = true
    }

    // MARK: - OAuth (Google/Apple)

    #if os(iOS)
    func signInWithGoogle(presentationAnchor: ASPresentationAnchor) async throws {
        try await performOAuthFlow(provider: "google", presentationAnchor: presentationAnchor)
    }

    func signInWithApple(presentationAnchor: ASPresentationAnchor) async throws {
        try await performOAuthFlow(provider: "apple", presentationAnchor: presentationAnchor)
    }

    private func performOAuthFlow(provider: String, presentationAnchor: ASPresentationAnchor) async throws {
        let callbackScheme = "bap"
        let authURL = baseURL.appendingPathComponent("api/auth/\(provider)")

        var components = URLComponents(url: authURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "callbackURL", value: "\(callbackScheme)://auth/callback")
        ]

        guard let url = components.url else {
            throw AuthError.invalidURL
        }

        let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { callbackURL, error in
                if let error = error {
                    if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        continuation.resume(throwing: AuthError.cancelled)
                    } else {
                        continuation.resume(throwing: error)
                    }
                    return
                }

                guard let callbackURL = callbackURL else {
                    continuation.resume(throwing: AuthError.invalidCallback)
                    return
                }

                continuation.resume(returning: callbackURL)
            }

            session.presentationContextProvider = WebAuthContextProvider(anchor: presentationAnchor)
            session.prefersEphemeralWebBrowserSession = false

            if !session.start() {
                continuation.resume(throwing: AuthError.sessionFailed)
            }
        }

        try await handleOAuthCallback(url: callbackURL)
    }
    #endif

    #if os(macOS)
    func signInWithGoogle() async throws {
        try await performOAuthFlow(provider: "google")
    }

    func signInWithApple() async throws {
        try await performOAuthFlow(provider: "apple")
    }

    private func performOAuthFlow(provider: String) async throws {
        let callbackScheme = "bap"
        let authURL = baseURL.appendingPathComponent("api/auth/\(provider)")

        var components = URLComponents(url: authURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "callbackURL", value: "\(callbackScheme)://auth/callback")
        ]

        guard let url = components.url else {
            throw AuthError.invalidURL
        }

        let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { callbackURL, error in
                if let error = error {
                    if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        continuation.resume(throwing: AuthError.cancelled)
                    } else {
                        continuation.resume(throwing: error)
                    }
                    return
                }

                guard let callbackURL = callbackURL else {
                    continuation.resume(throwing: AuthError.invalidCallback)
                    return
                }

                continuation.resume(returning: callbackURL)
            }

            session.prefersEphemeralWebBrowserSession = false

            if !session.start() {
                continuation.resume(throwing: AuthError.sessionFailed)
            }
        }

        try await handleOAuthCallback(url: callbackURL)
    }
    #endif

    private func handleOAuthCallback(url: URL) async throws {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let token = components.queryItems?.first(where: { $0.name == "token" })?.value else {
            throw AuthError.invalidCallback
        }

        saveSessionToken(token)

        let user = try await fetchCurrentUser(token: token)
        currentUser = user
        isAuthenticated = true
    }

    // MARK: - API Helpers

    private func fetchCurrentUser(token: String) async throws -> AuthUser {
        let url = baseURL.appendingPathComponent("api/auth/get-session")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw AuthError.unauthorized
        }

        let sessionResponse = try JSONDecoder().decode(SessionResponse.self, from: data)
        return sessionResponse.user
    }

    private func revokeSession(token: String) async throws {
        let url = baseURL.appendingPathComponent("api/auth/sign-out")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (_, _) = try await URLSession.shared.data(for: request)
    }

    // MARK: - Token Storage (Keychain)

    func getSessionToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: sessionTokenKey,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }

        return token
    }

    private func saveSessionToken(_ token: String) {
        deleteSessionToken()

        let data = token.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: sessionTokenKey,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]

        SecItemAdd(query as CFDictionary, nil)
    }

    private func deleteSessionToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: sessionTokenKey
        ]

        SecItemDelete(query as CFDictionary)
    }
}

// MARK: - Models

struct AuthUser: Codable, Identifiable {
    let id: String
    let email: String
    let name: String?
    let image: String?
}

struct AuthResponse: Codable {
    let token: String
    let user: AuthUser
}

struct SessionResponse: Codable {
    let session: SessionInfo
    let user: AuthUser
}

struct SessionInfo: Codable {
    let id: String
    let userId: String
    let expiresAt: String
}

enum AuthError: LocalizedError {
    case magicLinkFailed
    case invalidCallback
    case invalidToken
    case invalidURL
    case cancelled
    case sessionFailed
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .magicLinkFailed:
            return "Failed to send magic link"
        case .invalidCallback:
            return "Invalid authentication callback"
        case .invalidToken:
            return "Invalid or expired token"
        case .invalidURL:
            return "Invalid authentication URL"
        case .cancelled:
            return "Authentication was cancelled"
        case .sessionFailed:
            return "Failed to start authentication session"
        case .unauthorized:
            return "Not authorized"
        }
    }
}

// MARK: - Web Auth Context Provider

#if os(iOS)
class WebAuthContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    let anchor: ASPresentationAnchor

    init(anchor: ASPresentationAnchor) {
        self.anchor = anchor
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return anchor
    }
}
#endif
