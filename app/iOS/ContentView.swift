//
//  ContentView.swift
//  BapIOS
//
//  Main content view with tab navigation
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            ChatListView()
                .tabItem {
                    Label("Chats", systemImage: "bubble.left.and.bubble.right")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
    }
}

#Preview {
    ContentView()
}
