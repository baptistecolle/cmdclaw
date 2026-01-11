//
//  ChatListView.swift
//  BapIOS
//
//  List of all chats
//

import SwiftUI

struct ChatListView: View {
    @State private var chats: [Chat] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading chats...")
                } else if let error = errorMessage {
                    ContentUnavailableView {
                        Label("Error", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") {
                            Task { await loadChats() }
                        }
                    }
                } else if chats.isEmpty {
                    ContentUnavailableView {
                        Label("No Chats", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text("Start a new conversation")
                    } actions: {
                        Button("New Chat") {
                            // TODO: Create new chat
                        }
                        .buttonStyle(.borderedProminent)
                    }
                } else {
                    List(chats) { chat in
                        NavigationLink(value: chat) {
                            ChatRowView(chat: chat)
                        }
                    }
                    .refreshable {
                        await loadChats()
                    }
                }
            }
            .navigationTitle("Chats")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        // TODO: Create new chat
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .navigationDestination(for: Chat.self) { chat in
                ChatDetailView(chat: chat)
            }
        }
        .task {
            await loadChats()
        }
    }

    private func loadChats() async {
        isLoading = true
        errorMessage = nil

        do {
            // TODO: Replace with actual API call
            // chats = try await APIClient.shared.get("/api/chats")
            chats = [] // Placeholder
        } catch {
            errorMessage = error.localizedDescription
        }

        isLoading = false
    }
}

struct ChatRowView: View {
    let chat: Chat

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(chat.title ?? "Untitled Chat")
                .font(.headline)

            Text(chat.updatedAt, style: .relative)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    ChatListView()
}
