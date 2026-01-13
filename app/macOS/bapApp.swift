//
//  bapApp.swift
//  bap
//
//  Created by Baptiste Colle on 08/01/2026.
//

import SwiftUI

@main
struct bapApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }

    init() {
        // Register for URL scheme handling
        NSAppleEventManager.shared().setEventHandler(
            URLHandler.shared,
            andSelector: #selector(URLHandler.handleGetURL(event:reply:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
    }
}

class URLHandler: NSObject {
    static let shared = URLHandler()

    @objc func handleGetURL(event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let urlString = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
              let url = URL(string: urlString) else {
            return
        }

        Task { @MainActor in
            if url.scheme == "bap" && url.host == "auth" {
                do {
                    try await AuthManager.shared.handleMagicLinkCallback(url: url)
                } catch {
                    print("Failed to handle auth callback: \(error)")
                }
            }
        }
    }
}
