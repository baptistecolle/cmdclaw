import AVFoundation
import Foundation

@MainActor
class RecordingManager: NSObject {
    private var audioRecorder: AVAudioRecorder?
    private var currentRecordingURL: URL?
    private var meteringTimer: Timer?

    /// Callback for audio level updates (0.0 to 1.0)
    var onAudioLevelUpdate: ((Float) -> Void)?

    override init() {
        super.init()
        requestMicrophonePermission()
    }

    private func requestMicrophonePermission() {
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            if granted {
                print("Microphone access granted")
            } else {
                print("Microphone access denied")
            }
        }
    }

    func startRecording() {
        let tempDir = FileManager.default.temporaryDirectory
        let fileName = "bap_recording_\(Date().timeIntervalSince1970).wav"
        let fileURL = tempDir.appendingPathComponent(fileName)

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16000.0,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        do {
            audioRecorder = try AVAudioRecorder(url: fileURL, settings: settings)
            audioRecorder?.isMeteringEnabled = true
            audioRecorder?.prepareToRecord()
            audioRecorder?.record()
            currentRecordingURL = fileURL
            print("Recording started: \(fileURL.path)")

            // Start metering timer for audio level updates
            startMeteringTimer()
        } catch {
            print("Failed to start recording: \(error.localizedDescription)")
        }
    }

    private func startMeteringTimer() {
        meteringTimer?.invalidate()
        meteringTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.updateAudioLevel()
            }
        }
    }

    private func updateAudioLevel() {
        guard let recorder = audioRecorder, recorder.isRecording else { return }

        recorder.updateMeters()
        let averagePower = recorder.averagePower(forChannel: 0)

        // Convert dB to linear scale (0.0 to 1.0)
        // averagePower ranges from -160 dB (silence) to 0 dB (max)
        // We map -50 dB to 0 and 0 dB to 1 for better visual response
        let minDb: Float = -50.0
        let normalizedLevel = max(0, (averagePower - minDb) / (-minDb))
        let clampedLevel = min(1.0, normalizedLevel)

        onAudioLevelUpdate?(clampedLevel)
    }

    private func stopMeteringTimer() {
        meteringTimer?.invalidate()
        meteringTimer = nil
        onAudioLevelUpdate?(0)
    }

    func stopRecording() -> URL? {
        stopMeteringTimer()
        audioRecorder?.stop()
        audioRecorder = nil

        guard let url = currentRecordingURL else { return nil }
        print("Recording stopped: \(url.path)")

        currentRecordingURL = nil
        return url
    }

    var isRecording: Bool {
        audioRecorder?.isRecording ?? false
    }
}
