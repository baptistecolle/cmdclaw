import AVFoundation
import Foundation

@MainActor
class RecordingManager: NSObject {
    private var audioRecorder: AVAudioRecorder?
    private var currentRecordingURL: URL?

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
            audioRecorder?.prepareToRecord()
            audioRecorder?.record()
            currentRecordingURL = fileURL
            print("Recording started: \(fileURL.path)")
        } catch {
            print("Failed to start recording: \(error.localizedDescription)")
        }
    }

    func stopRecording() -> URL? {
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
