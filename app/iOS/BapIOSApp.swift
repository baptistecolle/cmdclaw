//
//  BapIOSApp.swift
//  BapIOS
//
//  iOS app entry point
//

import SwiftUI

@main
struct BapIOSApp: App {
    @State private var authManager = AuthManager.shared

    var body: some Scene {
        WindowGroup {
            RootView(authManager: authManager)
                .task {
                    await authManager.initialize()
                }
        }
    }
}

struct RootView: View {
    @Bindable var authManager: AuthManager

    var body: some View {
        Group {
            if authManager.isLoading {
                // Loading state
                VStack(spacing: 16) {
                    ProgressView()
                    Text("Loading...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else if authManager.isAuthenticated {
                // Authenticated - show main app
                ContentView()
            } else {
                // Not authenticated - show login
                LoginView()
            }
        }
        .animation(.easeInOut, value: authManager.isAuthenticated)
        .animation(.easeInOut, value: authManager.isLoading)
    }
}
