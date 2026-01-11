//
//  ChatDetailView.swift
//  BapIOS
//
//  Individual chat conversation view
//

import SwiftUI

struct ChatDetailView: View {
    let chat: Chat

    @State private var messages: [Message] = []
    @State private var inputText = ""
    @State private var isLoading = false
    @State private var isSending = false
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Messages list
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(messages) { message in
                            MessageBubbleView(message: message)
                                .id(message.id)
                        }

                        if isSending {
                            HStack {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Thinking...")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal)
                        }
                    }
                    .padding()
                }
                .onChange(of: messages.count) { _, _ in
                    if let lastMessage = messages.last {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            // Input area
            HStack(spacing: 12) {
                TextField("Message...", text: $inputText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .focused($isInputFocused)
                    .onSubmit {
                        sendMessage()
                    }

                Button {
                    sendMessage()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending)
            }
            .padding()
            .background(.bar)
        }
        .navigationTitle(chat.title ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadMessages()
        }
    }

    private func loadMessages() async {
        isLoading = true
        // TODO: Load messages from API
        isLoading = false
    }

    private func sendMessage() {
        let content = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !content.isEmpty else { return }

        inputText = ""
        isSending = true

        // Add user message immediately
        let userMessage = Message(
            id: UUID().uuidString,
            chatId: chat.id,
            role: .user,
            content: content,
            createdAt: Date()
        )
        messages.append(userMessage)

        Task {
            // TODO: Send to API and get response
            // For now, simulate a response
            try? await Task.sleep(for: .seconds(1))

            let assistantMessage = Message(
                id: UUID().uuidString,
                chatId: chat.id,
                role: .assistant,
                content: "This is a placeholder response. Connect to the server to get real responses.",
                createdAt: Date()
            )
            messages.append(assistantMessage)
            isSending = false
        }
    }
}

struct MessageBubbleView: View {
    let message: Message

    private var isUser: Bool {
        message.role == .user
    }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 60) }

            Text(message.content)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(isUser ? Color.blue : Color(.systemGray5))
                .foregroundStyle(isUser ? .white : .primary)
                .clipShape(RoundedRectangle(cornerRadius: 18))

            if !isUser { Spacer(minLength: 60) }
        }
    }
}

#Preview {
    NavigationStack {
        ChatDetailView(chat: Chat(
            id: "1",
            title: "Test Chat",
            createdAt: Date(),
            updatedAt: Date()
        ))
    }
}
