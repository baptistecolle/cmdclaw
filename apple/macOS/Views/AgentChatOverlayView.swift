//
//  AgentChatOverlayView.swift
//  Bap
//
//  HUD-style overlay for agent chat
//

import SwiftUI

struct AgentChatOverlayView: View {
    var manager: ChatOverlayManager
    let onDismiss: () -> Void
    let onRecordAgain: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            // State indicator at top
            stateIndicator
                .padding(.top, 8)

            // Content area
            contentArea

            // Bottom hint
            if canRecordAgain {
                Text("⌥ Space to record again")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.5))
                    .padding(.bottom, 8)
            }
        }
        .padding(20)
        .frame(width: 400)
        .frame(minHeight: 120)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(Color.black.opacity(0.75))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.white.opacity(0.1), lineWidth: 1)
        )
        .onTapGesture {
            // Dismiss on tap when complete
            if canRecordAgain {
                onDismiss()
            }
        }
    }

    // MARK: - State Indicator

    @ViewBuilder
    private var stateIndicator: some View {
        HStack(spacing: 8) {
            switch manager.state {
            case .recording:
                HStack(spacing: 10) {
                    Circle()
                        .fill(Color.red)
                        .frame(width: 10, height: 10)
                        .modifier(PulseAnimation())
                    AudioWaveformView(
                        audioLevel: manager.audioLevel,
                        barCount: 5,
                        barSpacing: 3,
                        minBarHeight: 4,
                        maxBarHeight: 20,
                        barColor: .red
                    )
                }
                Text("Listening...")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)

            case .transcribing:
                ProgressView()
                    .progressViewStyle(.circular)
                    .controlSize(.small)
                    .tint(.white)
                Text("Transcribing...")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)

            case .sendingToAgent:
                ProgressView()
                    .progressViewStyle(.circular)
                    .controlSize(.small)
                    .tint(.white)
                Text("Working on it...")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)

            case .streaming, .complete:
                // Show same indicator for both states to avoid flashing
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Done")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)

            case .error(let message):
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundStyle(.red)
                Text(message)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.red)
                    .lineLimit(1)

            case .idle:
                EmptyView()
            }
        }
    }

    // MARK: - Content Area

    @ViewBuilder
    private var contentArea: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Show user's transcription in muted style
            if !manager.userTranscription.isEmpty && manager.state != ChatOverlayManager.OverlayState.recording {
                HStack {
                    Text("You:")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.5))
                    Text(manager.userTranscription)
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(2)
                }
            }

            // Show streaming or final response
            if !manager.streamingContent.isEmpty {
                ScrollView {
                    Text(manager.streamingContent)
                        .font(.system(size: 15))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .frame(maxHeight: 200)
            } else if let lastAssistantMessage = manager.messages.last(where: { $0.role == .assistant }) {
                ScrollView {
                    Text(lastAssistantMessage.content)
                        .font(.system(size: 15))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .frame(maxHeight: 200)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Helpers

    private var canRecordAgain: Bool {
        switch manager.state {
        case .complete, .error:
            return true
        default:
            return false
        }
    }
}

// MARK: - Pulse Animation

struct PulseAnimation: ViewModifier {
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(isPulsing ? 1.2 : 1.0)
            .opacity(isPulsing ? 0.8 : 1.0)
            .animation(
                .easeInOut(duration: 0.8)
                .repeatForever(autoreverses: true),
                value: isPulsing
            )
            .onAppear {
                isPulsing = true
            }
    }
}
