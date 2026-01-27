import SwiftUI

enum RecordingState {
    case recording
    case transcribing
}

struct FloatingRecordingView: View {
    let state: RecordingState
    let onTap: () -> Void

    @State private var animationAmount = 1.0

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(state == .recording ? Color.red.opacity(0.3) : Color.blue.opacity(0.3))
                    .frame(width: 60, height: 60)
                    .scaleEffect(animationAmount)
                    .animation(
                        state == .recording ?
                            .easeInOut(duration: 0.8).repeatForever(autoreverses: true) :
                            .default,
                        value: animationAmount
                    )

                Image(systemName: state == .recording ? "waveform" : "ellipsis")
                    .font(.system(size: 24, weight: .medium))
                    .foregroundColor(state == .recording ? .red : .blue)
            }

            Text(state == .recording ? "Recording..." : "Transcribing...")
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.primary)

            if state == .recording {
                Text("Press ⌥ Space to stop")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }
        }
        .padding(20)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.primary.opacity(0.1), lineWidth: 1)
        )
        .onAppear {
            if state == .recording {
                animationAmount = 1.2
            }
        }
        .onTapGesture {
            if state == .recording {
                onTap()
            }
        }
    }
}

#Preview("Recording") {
    FloatingRecordingView(state: .recording) {}
        .frame(width: 300, height: 200)
        .background(Color.gray.opacity(0.3))
}

#Preview("Transcribing") {
    FloatingRecordingView(state: .transcribing) {}
        .frame(width: 300, height: 200)
        .background(Color.gray.opacity(0.3))
}
