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
}

