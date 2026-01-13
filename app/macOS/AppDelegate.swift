import AppKit
import SwiftUI

@MainActor
class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var loginWindow: NSWindow?
    private var chatWindow: NSPanel?
    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var recordingManager: RecordingManager?
    private var whisperTranscriber: WhisperTranscriber?
    private var isRecording = false
    private var authObservationTask: Task<Void, Never>?
    private var dismissObserver: NSObjectProtocol?
    private let chatOverlayManager = ChatOverlayManager.shared

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenuBar()
        setupManagers()
        setupAuthObserver()
        setupDismissObserver()
        registerURLHandler()

        // Initialize auth and check state
        Task {
            await AuthManager.shared.initialize()
            handleAuthStateChange()
        }
    }

    private func registerURLHandler() {
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleURLEvent(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
    }

    @objc private func handleURLEvent(_ event: NSAppleEventDescriptor, withReplyEvent replyEvent: NSAppleEventDescriptor) {
        guard let urlString = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let url = URL(string: urlString) else {
            print("[Auth] Failed to parse URL from event")
            return
        }

        print("[Auth] Received URL: \(url)")

        // Handle auth callback
        if url.scheme == "bap" && url.host == "auth" {
            Task {
                do {
                    try await AuthManager.shared.handleMagicLinkCallback(url: url)
                    handleAuthStateChange()
                } catch {
                    print("[Auth] Magic link callback failed: \(error)")
                }
            }
        }
    }

    private func setupDismissObserver() {
        dismissObserver = NotificationCenter.default.addObserver(
            forName: .dismissChatOverlay,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.hideChatOverlay()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        authObservationTask?.cancel()
        if let dismissObserver = dismissObserver {
            NotificationCenter.default.removeObserver(dismissObserver)
        }
        if let globalMonitor = globalMonitor {
            NSEvent.removeMonitor(globalMonitor)
        }
        if let localMonitor = localMonitor {
            NSEvent.removeMonitor(localMonitor)
        }
    }

    private func setupAuthObserver() {
        authObservationTask = Task { @MainActor in
            var previousAuthState = AuthManager.shared.isAuthenticated
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                let currentAuthState = AuthManager.shared.isAuthenticated
                if currentAuthState != previousAuthState {
                    previousAuthState = currentAuthState
                    handleAuthStateChange()
                }
            }
        }
    }

    private func handleAuthStateChange() {
        if AuthManager.shared.isAuthenticated {
            hideLoginWindow()
            enableFullFunctionality()
        } else if !AuthManager.shared.isLoading {
            disableFunctionality()
            showLoginWindow()
        }
    }

    private func enableFullFunctionality() {
        checkAccessibilityPermissions()
        setupGlobalHotKey()
        updateMenuForAuthenticatedState()
    }

    private func disableFunctionality() {
        // Remove hotkey monitors when signed out
        if let globalMonitor = globalMonitor {
            NSEvent.removeMonitor(globalMonitor)
            self.globalMonitor = nil
        }
        if let localMonitor = localMonitor {
            NSEvent.removeMonitor(localMonitor)
            self.localMonitor = nil
        }
        updateMenuForUnauthenticatedState()
    }

    private func setupMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.image = NSImage(named: "MenuBarIcon")
        }

        updateMenuForUnauthenticatedState()
    }

    private func updateMenuForAuthenticatedState() {
        let menu = NSMenu()

        if let user = AuthManager.shared.currentUser {
            let userItem = NSMenuItem(title: user.email, action: nil, keyEquivalent: "")
            userItem.isEnabled = false
            menu.addItem(userItem)
            menu.addItem(NSMenuItem.separator())
        }

        menu.addItem(NSMenuItem(title: "Record (⌥ Space)", action: #selector(toggleRecording), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Check Accessibility...", action: #selector(openAccessibilityPrefs), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Sign Out", action: #selector(signOut), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q"))

        statusItem.menu = menu
    }

    private func updateMenuForUnauthenticatedState() {
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Sign In...", action: #selector(showLoginWindowAction), keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
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

    // MARK: - Login Window

    @objc private func showLoginWindowAction() {
        showLoginWindow()
    }

    private func showLoginWindow() {
        if loginWindow != nil { return }

        let loginView = LoginView()
        let hostingController = NSHostingController(rootView: loginView)

        let window = NSWindow(contentViewController: hostingController)
        window.title = "Sign in to Bap"
        window.styleMask = [.titled, .closable]
        window.level = .floating
        window.center()
        window.makeKeyAndOrderFront(nil)

        // Activate the app so the window comes to front
        NSApp.activate(ignoringOtherApps: true)

        loginWindow = window
    }

    private func hideLoginWindow() {
        loginWindow?.close()
        loginWindow = nil
    }

    // MARK: - Sign Out

    @objc private func signOut() {
        Task {
            await AuthManager.shared.signOut()
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
        // Only handle if authenticated
        guard AuthManager.shared.isAuthenticated else { return false }

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
        guard AuthManager.shared.isAuthenticated else {
            showLoginWindow()
            return
        }

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

        // Show chat overlay with recording state
        chatOverlayManager.setRecording()
        showChatOverlay()

        recordingManager?.startRecording()
    }

    private func stopRecording() {
        guard isRecording else { return }
        isRecording = false

        updateMenuBarIcon(recording: false)

        guard let audioURL = recordingManager?.stopRecording() else {
            chatOverlayManager.handleError("No audio recorded")
            return
        }

        Task {
            await transcribeAudio(url: audioURL)
        }
    }

    private func transcribeAudio(url: URL) async {
        chatOverlayManager.setTranscribing()

        do {
            let transcription = try await whisperTranscriber?.transcribe(audioURL: url) ?? ""

            guard !transcription.isEmpty else {
                chatOverlayManager.handleError("No speech detected")
                return
            }

            // Add user message and send to agent
            chatOverlayManager.addUserMessage(transcription)
            await sendToAgent(content: transcription)

        } catch {
            chatOverlayManager.handleError("Transcription failed: \(error.localizedDescription)")
        }
    }

    private func sendToAgent(content: String) async {
        do {
            try await AgentClient.shared.sendMessage(
                content: content,
                conversationId: chatOverlayManager.currentConversationId
            ) { [weak self] event in
                guard let self = self else { return }

                switch event {
                case .text(let text):
                    if self.chatOverlayManager.state != ChatOverlayManager.OverlayState.streaming {
                        self.chatOverlayManager.startStreaming()
                    }
                    self.chatOverlayManager.appendStreamingContent(text)

                case .toolUse, .toolResult:
                    // Tool events can be displayed optionally
                    break

                case .done(let conversationId, _, _):
                    self.chatOverlayManager.finishStreaming(conversationId: conversationId)

                case .error(let message):
                    self.chatOverlayManager.handleError(message)
                }
            }
        } catch {
            chatOverlayManager.handleError("Connection failed: \(error.localizedDescription)")
        }
    }

    private func updateMenuBarIcon(recording: Bool) {
        if let button = statusItem.button {
            button.image = NSImage(named: "MenuBarIcon")
        }
    }

    // MARK: - Chat Overlay

    private func showChatOverlay() {
        // If overlay already exists, just update it (SwiftUI handles the rest)
        if chatWindow != nil { return }

        let contentView = AgentChatOverlayView(
            manager: chatOverlayManager,
            onDismiss: { [weak self] in
                self?.hideChatOverlay()
            },
            onRecordAgain: { [weak self] in
                self?.chatOverlayManager.cancelAutoDismiss()
                self?.startRecording()
            }
        )

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

        chatWindow = panel
    }

    private func hideChatOverlay() {
        chatWindow?.close()
        chatWindow = nil
        chatOverlayManager.reset()
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
