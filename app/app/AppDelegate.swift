import AppKit
import SwiftUI

@MainActor
class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var recordingWindow: NSPanel?
    private var resultWindow: NSPanel?
    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var recordingManager: RecordingManager?
    private var whisperTranscriber: WhisperTranscriber?
    private var isRecording = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenuBar()
        checkAccessibilityPermissions()
        setupGlobalHotKey()
        setupManagers()
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let globalMonitor = globalMonitor {
            NSEvent.removeMonitor(globalMonitor)
        }
        if let localMonitor = localMonitor {
            NSEvent.removeMonitor(localMonitor)
        }
    }

    private func setupMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "waveform", accessibilityDescription: "Bap")
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Record (⌥ Space)", action: #selector(toggleRecording), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Check Accessibility...", action: #selector(openAccessibilityPrefs), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q"))

        statusItem.menu = menu
    }

    private func setupManagers() {
        recordingManager = RecordingManager()
        whisperTranscriber = WhisperTranscriber()

        Task {
            await whisperTranscriber?.loadModel()
        }
    }

    // MARK: - Accessibility Check

    private func checkAccessibilityPermissions() {
        let trusted = AXIsProcessTrusted()
        if !trusted {
            print("Accessibility permissions not granted. Opening System Preferences...")
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
            AXIsProcessTrustedWithOptions(options as CFDictionary)
        } else {
            print("Accessibility permissions granted")
        }
    }

    @objc private func openAccessibilityPrefs() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        NSWorkspace.shared.open(url)
    }

    // MARK: - Global Hot Key (Option + Space)

    private func setupGlobalHotKey() {
        // Global monitor for when app is not focused
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.handleKeyEvent(event)
        }

        // Local monitor for when app is focused
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if self?.handleKeyEvent(event) == true {
                return nil // Consume the event
            }
            return event
        }

        print("Global hotkey registered: Option + Space")
    }

    @discardableResult
    private func handleKeyEvent(_ event: NSEvent) -> Bool {
        // Option + Space: keyCode 49 = Space, modifierFlags contains .option
        let isOptionPressed = event.modifierFlags.contains(.option)
        let isSpaceKey = event.keyCode == 49

        if isOptionPressed && isSpaceKey {
            Task { @MainActor in
                self.toggleRecording()
            }
            return true
        }
        return false
    }

    static var shared: AppDelegate? {
        NSApp.delegate as? AppDelegate
    }

    // MARK: - Recording

    @objc func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        guard !isRecording else { return }
        isRecording = true

        updateMenuBarIcon(recording: true)
        showRecordingWindow()

        recordingManager?.startRecording()
    }

    private func stopRecording() {
        guard isRecording else { return }
        isRecording = false

        updateMenuBarIcon(recording: false)

        guard let audioURL = recordingManager?.stopRecording() else {
            hideRecordingWindow()
            return
        }

        Task {
            await transcribeAudio(url: audioURL)
        }
    }

    private func transcribeAudio(url: URL) async {
        updateRecordingWindowState(.transcribing)

        do {
            let transcription = try await whisperTranscriber?.transcribe(audioURL: url) ?? ""
            hideRecordingWindow()
            showResultWindow(text: transcription)
        } catch {
            hideRecordingWindow()
            showResultWindow(text: "Transcription failed: \(error.localizedDescription)")
        }
    }

    private func updateMenuBarIcon(recording: Bool) {
        if let button = statusItem.button {
            let symbolName = recording ? "waveform.circle.fill" : "waveform"
            button.image = NSImage(systemSymbolName: symbolName, accessibilityDescription: "Bap")
            button.contentTintColor = recording ? .systemRed : nil
        }
    }

    // MARK: - Windows

    private func showRecordingWindow() {
        let contentView = FloatingRecordingView(state: .recording) { [weak self] in
            self?.toggleRecording()
        }

        let hostingView = NSHostingView(rootView: contentView)
        hostingView.frame = NSRect(x: 0, y: 0, width: 200, height: 100)

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 200, height: 100),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        panel.contentView = hostingView
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        positionWindowAtCenter(panel)
        panel.orderFrontRegardless()

        recordingWindow = panel
    }

    private func updateRecordingWindowState(_ state: RecordingState) {
        guard let panel = recordingWindow else { return }

        let contentView = FloatingRecordingView(state: state) { [weak self] in
            self?.toggleRecording()
        }

        let hostingView = NSHostingView(rootView: contentView)
        hostingView.frame = panel.contentView?.frame ?? NSRect(x: 0, y: 0, width: 200, height: 100)
        panel.contentView = hostingView
    }

    private func hideRecordingWindow() {
        recordingWindow?.close()
        recordingWindow = nil
    }

    private func showResultWindow(text: String) {
        let contentView = TranscriptionResultView(text: text) { [weak self] in
            self?.hideResultWindow()
        }

        let hostingView = NSHostingView(rootView: contentView)
        hostingView.frame = NSRect(x: 0, y: 0, width: 400, height: 200)

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 400, height: 200),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        panel.contentView = hostingView
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        positionWindowAtCenter(panel)
        panel.orderFrontRegardless()

        resultWindow = panel
    }

    private func hideResultWindow() {
        resultWindow?.close()
        resultWindow = nil
    }

    private func positionWindowAtCenter(_ window: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let screenFrame = screen.visibleFrame
        let windowFrame = window.frame

        let x = screenFrame.midX - windowFrame.width / 2
        let y = screenFrame.midY - windowFrame.height / 2

        window.setFrameOrigin(NSPoint(x: x, y: y))
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }
}
