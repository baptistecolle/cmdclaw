//
//  ChatOverlayManager.swift
//  Bap
//
//  State manager for the agent chat overlay
//

import Foundation
import Observation

extension Notification.Name {
    static let dismissChatOverlay = Notification.Name("dismissChatOverlay")
}

@MainActor
@Observable
final class ChatOverlayManager {
    static let shared = ChatOverlayManager()

    // MARK: - Types

    enum OverlayState: Equatable {
        case idle
        case recording
        case transcribing
        case sendingToAgent
        case streaming
        case complete
        case error(String)

        static func == (lhs: OverlayState, rhs: OverlayState) -> Bool {
            switch (lhs, rhs) {
            case (.idle, .idle),
                 (.recording, .recording),
                 (.transcribing, .transcribing),
                 (.sendingToAgent, .sendingToAgent),
                 (.streaming, .streaming),
                 (.complete, .complete):
                return true
            case (.error(let a), .error(let b)):
                return a == b
            default:
                return false
            }
        }
    }

    struct ChatMessage: Identifiable {
        let id = UUID()
        let role: Role
        var content: String
        let timestamp: Date

        enum Role {
            case user
            case assistant
        }
    }

    // MARK: - State

    var state: OverlayState = .idle
    var messages: [ChatMessage] = []
    var streamingContent: String = ""
    var currentConversationId: String?
    var userTranscription: String = ""

    // MARK: - Private

    private var dismissTask: Task<Void, Never>?
    private let autoDismissDelay: TimeInterval = 7.0

    private init() {}

    // MARK: - Public Methods

    func reset() {
        state = .idle
        messages = []
        streamingContent = ""
        currentConversationId = nil
        userTranscription = ""
        dismissTask?.cancel()
    }

    func setRecording() {
        state = .recording
        cancelAutoDismiss()
    }

    func setTranscribing() {
        state = .transcribing
    }

    func addUserMessage(_ content: String) {
        userTranscription = content
        messages.append(ChatMessage(role: .user, content: content, timestamp: Date()))
        state = .sendingToAgent
    }

    func startStreaming() {
        state = .streaming
        streamingContent = ""
    }

    func appendStreamingContent(_ text: String) {
        streamingContent += text
    }

    func finishStreaming(conversationId: String) {
        // Convert streaming content to final message
        if !streamingContent.isEmpty {
            messages.append(ChatMessage(role: .assistant, content: streamingContent, timestamp: Date()))
        }
        streamingContent = ""
        currentConversationId = conversationId
        state = .complete

        // Start auto-dismiss timer
        startAutoDismissTimer()
    }

    func handleError(_ message: String) {
        state = .error(message)
        streamingContent = ""
        // Auto-dismiss errors after a longer delay
        startAutoDismissTimer(delay: 10.0)
    }

    func cancelAutoDismiss() {
        dismissTask?.cancel()
        dismissTask = nil
    }

    // MARK: - Private Methods

    private func startAutoDismissTimer(delay: TimeInterval? = nil) {
        dismissTask?.cancel()
        let dismissDelay = delay ?? autoDismissDelay

        dismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(dismissDelay))

            guard !Task.isCancelled else { return }

            await MainActor.run {
                NotificationCenter.default.post(name: .dismissChatOverlay, object: nil)
            }
        }
    }
}
