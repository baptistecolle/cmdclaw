//
//  AuthManager.swift
//  Bap
//
//  Shared authentication manager for iOS and macOS
//

import Foundation
import AuthenticationServices
import SwiftUI
import Observation

@MainActor
@Observable
final class AuthManager {
    static let shared = AuthManager()

    var isAuthenticated = false
    var isLoading = true
    var currentUser: AuthUser?
    var errorMessage: String?

    private let baseURL: URL
    private let keychainService = "com.bap.auth"
    private let sessionTokenKey = "sessionToken"

    private init() {
        #if DEBUG
        self.baseURL = URL(string: "http://localhost:3000")!
        #else
        self.baseURL = URL(string: "https://www.heybap.com")!
        #endif
    }

    func initialize() async {
        await checkSession()
    }

    // MARK: - Session Management

    func checkSession() async {
        isLoading = true
        defer { isLoading = false }

        guard let token = getSessionToken() else {
            print("[Auth] No session token found in keychain")
            isAuthenticated = false
            currentUser = nil
            return
        }

        print("[Auth] Found session token, verifying with server...")

        do {
            let user = try await fetchCurrentUser(token: token)
            currentUser = user
            isAuthenticated = true
            print("[Auth] Session verified, user: \(user.email)")
        } catch {
            print("[Auth] Session verification failed: \(error)")
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
        let url = baseURL.appendingPathComponent("api/auth/sign-in/magic-link")
        print("[Auth] Sending magic link to \(email) via \(url)")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Use native-callback endpoint to get the session token passed to the app
        let nativeCallbackURL = baseURL.appendingPathComponent("api/auth/native-callback")
        var callbackComponents = URLComponents(url: nativeCallbackURL, resolvingAgainstBaseURL: false)!
        callbackComponents.queryItems = [URLQueryItem(name: "redirect", value: "bap://auth/callback")]

        let body: [String: String] = [
            "email": email,
            "callbackURL": callbackComponents.url!.absoluteString
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            print("[Auth] Network error sending magic link: \(error)")
            throw AuthError.magicLinkFailed
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            print("[Auth] Invalid response type")
            throw AuthError.magicLinkFailed
        }

        print("[Auth] Magic link response: \(httpResponse.statusCode)")

        guard (200...299).contains(httpResponse.statusCode) else {
            if let responseBody = String(data: data, encoding: .utf8) {
                print("[Auth] Magic link error response: \(responseBody)")
            }
            throw AuthError.magicLinkFailed
        }
    }

    func handleMagicLinkCallback(url: URL) async throws {
        print("[Auth] Handling magic link callback: \(url)")

        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            print("[Auth] Failed to parse callback URL")
            throw AuthError.invalidCallback
        }

        // Check for error in callback
        if let error = components.queryItems?.first(where: { $0.name == "error" })?.value {
            print("[Auth] Callback error: \(error)")
            throw AuthError.invalidCallback
        }

        // Extract session token from callback URL (passed by native-callback endpoint)
        guard let token = components.queryItems?.first(where: { $0.name == "token" })?.value else {
            print("[Auth] No token found in callback URL")
            throw AuthError.invalidCallback
        }

        print("[Auth] Received session token, saving and fetching user...")

        // Save the session token
        saveSessionToken(token)

        // Fetch user info with the new token
        do {
            let user = try await fetchCurrentUser(token: token)
            currentUser = user
            isAuthenticated = true
            print("[Auth] Successfully authenticated: \(user.email)")
        } catch {
            print("[Auth] Failed to fetch user after magic link: \(error)")
            deleteSessionToken()
            throw error
        }
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
        print("[Auth] Fetching user from: \(url)")

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            print("[Auth] Invalid response type")
            throw AuthError.unauthorized
        }

        print("[Auth] get-session response status: \(httpResponse.statusCode)")

        if let responseBody = String(data: data, encoding: .utf8) {
            print("[Auth] get-session response: \(responseBody)")
        }

        guard (200...299).contains(httpResponse.statusCode) else {
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

struct AuthUser: Codable, Identifiable, Sendable {
    let id: String
    let email: String
    let name: String?
    let image: String?
}

struct AuthResponse: Codable, Sendable {
    let token: String
    let user: AuthUser
}

struct SessionResponse: Codable, Sendable {
    let session: SessionInfo
    let user: AuthUser
}

struct SessionInfo: Codable, Sendable {
    let id: String
    let userId: String
    let expiresAt: String
}

enum AuthError: LocalizedError, Sendable {
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
