import Foundation
import WhisperKit

@MainActor
class WhisperTranscriber {
    private var whisperKit: WhisperKit?
    private var isLoading = false
    private(set) var isModelLoaded = false

    func loadModel() async {
        guard !isLoading && !isModelLoaded else { return }

        isLoading = true
        print("Loading WhisperKit model (base.en)...")

        do {
            let config = WhisperKitConfig(model: "base.en")
            whisperKit = try await WhisperKit(config)
            isModelLoaded = true
            print("WhisperKit model loaded successfully")
        } catch {
            print("Failed to load WhisperKit model: \(error.localizedDescription)")
        }

        isLoading = false
    }

    func transcribe(audioURL: URL) async throws -> String {
        guard let whisperKit = whisperKit else {
            if !isModelLoaded {
                await loadModel()
            }
            guard let kit = self.whisperKit else {
                throw TranscriptionError.modelNotLoaded
            }
            return try await transcribeWithKit(kit, audioURL: audioURL)
        }

        return try await transcribeWithKit(whisperKit, audioURL: audioURL)
    }

    private func transcribeWithKit(_ kit: WhisperKit, audioURL: URL) async throws -> String {
        print("Transcribing audio: \(audioURL.path)")

        let results = try await kit.transcribe(audioPath: audioURL.path)
        let transcription = results.map { $0.text }.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)

        print("Transcription complete: \(transcription)")
        return transcription
    }
}

enum TranscriptionError: LocalizedError {
    case modelNotLoaded
    case transcriptionFailed(String)

    var errorDescription: String? {
        switch self {
        case .modelNotLoaded:
            return "Whisper model is not loaded"
        case .transcriptionFailed(let reason):
            return "Transcription failed: \(reason)"
        }
    }
}
