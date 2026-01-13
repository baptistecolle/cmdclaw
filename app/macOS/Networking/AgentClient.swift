//
//  AgentClient.swift
//  Bap
//
//  Streaming HTTP client for the ORPC chat API
//

import Foundation

// MARK: - Chat Event Types

enum ChatEvent {
    case text(content: String)
    case toolUse(toolName: String, toolInput: String)
    case toolResult(toolName: String, result: String)
    case done(conversationId: String, messageId: String, usage: ChatUsage)
    case error(message: String)
}

struct ChatUsage: Sendable {
    let inputTokens: Int
    let outputTokens: Int
    let totalCostUsd: Double
}

// MARK: - Request/Response Models

private struct AgentMessageInput: Encodable {
    let conversationId: String?
    let content: String
    let model: String?
}

private struct AgentMessageRequest: Encodable {
    let json: AgentMessageInput
}

// MARK: - Agent Client

actor AgentClient {
    static let shared = AgentClient()

    private let baseURL: URL

    private init() {
        #if DEBUG
        self.baseURL = URL(string: "http://localhost:3000")!
        #else
        self.baseURL = URL(string: "https://www.heybap.com")!
        #endif
    }

    /// Send a message to the agent and stream the response
    func sendMessage(
        content: String,
        conversationId: String? = nil,
        onEvent: @MainActor @escaping (ChatEvent) -> Void
    ) async throws {
        let url = baseURL.appendingPathComponent("api/rpc/chat/sendMessage")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120 // 2 minutes for long responses

        print("[AgentClient] Sending request to: \(url.absoluteString)")

        // Add auth token from keychain
        if let token = await MainActor.run(body: { AuthManager.shared.getSessionToken() }) {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            print("[AgentClient] Auth token present: \(token.prefix(20))...")
        } else {
            print("[AgentClient] WARNING: No auth token found")
        }

        let input = AgentMessageInput(
            conversationId: conversationId,
            content: content,
            model: nil
        )
        let body = AgentMessageRequest(json: input)
        request.httpBody = try JSONEncoder().encode(body)

        if let bodyString = String(data: request.httpBody!, encoding: .utf8) {
            print("[AgentClient] Request body: \(bodyString)")
        }

        let (bytes, response) = try await URLSession.shared.bytes(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            print("[AgentClient] ERROR: Invalid response type")
            await onEvent(.error(message: "Invalid response"))
            return
        }

        print("[AgentClient] Response status: \(httpResponse.statusCode)")
        print("[AgentClient] Response headers: \(httpResponse.allHeaderFields)")

        if httpResponse.statusCode == 401 {
            print("[AgentClient] ERROR: Not authenticated (401)")
            await onEvent(.error(message: "Not authenticated"))
            return
        }

        if httpResponse.statusCode != 200 {
            // Try to read the error response body
            var errorBody = ""
            for try await byte in bytes {
                errorBody.append(Character(UnicodeScalar(byte)))
            }
            print("[AgentClient] ERROR: Server error \(httpResponse.statusCode)")
            print("[AgentClient] Error body: \(errorBody)")
            await onEvent(.error(message: "Server error: \(httpResponse.statusCode) - \(errorBody)"))
            return
        }

        // Parse streaming JSON events line by line
        var buffer = ""
        var byteCount = 0
        print("[AgentClient] Starting to read stream...")

        for try await byte in bytes {
            byteCount += 1
            if byteCount == 1 {
                print("[AgentClient] First byte received")
            }
            let char = Character(UnicodeScalar(byte))
            buffer.append(char)

            // Process complete lines
            while let newlineIndex = buffer.firstIndex(of: "\n") {
                let line = String(buffer[..<newlineIndex])
                buffer = String(buffer[buffer.index(after: newlineIndex)...])

                if !line.trimmingCharacters(in: .whitespaces).isEmpty {
                    print("[AgentClient] Line received: \(line.prefix(200))")
                }

                if let event = parseEvent(line) {
                    print("[AgentClient] Parsed event: \(event)")
                    await onEvent(event)

                    // Stop processing on terminal events
                    if case .done = event {
                        print("[AgentClient] Stream complete (done event)")
                        return
                    }
                    if case .error = event {
                        print("[AgentClient] Stream complete (error event)")
                        return
                    }
                }
            }
        }

        print("[AgentClient] Stream ended. Total bytes: \(byteCount), remaining buffer: \(buffer.prefix(200))")

        // Process any remaining buffer
        if !buffer.isEmpty, let event = parseEvent(buffer) {
            print("[AgentClient] Parsed final buffer event: \(event)")
            await onEvent(event)
        }
    }

    private func parseEvent(_ line: String) -> ChatEvent? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // Handle SSE format - strip "data: " prefix
        var jsonLine = trimmed
        if jsonLine.hasPrefix("data: ") {
            jsonLine = String(jsonLine.dropFirst(6))
        } else if jsonLine.hasPrefix("data:") {
            jsonLine = String(jsonLine.dropFirst(5))
        }

        // Skip SSE comments and empty data
        guard !jsonLine.isEmpty, !jsonLine.hasPrefix(":") else { return nil }

        guard let data = jsonLine.data(using: .utf8) else {
            print("[AgentClient] Failed to convert line to data: \(jsonLine.prefix(100))")
            return nil
        }

        guard let rawJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            print("[AgentClient] Failed to parse JSON: \(jsonLine.prefix(100))")
            return nil
        }

        // Server wraps events in {"json": {...}} - unwrap if present
        let json: [String: Any]
        if let wrapped = rawJson["json"] as? [String: Any] {
            json = wrapped
        } else {
            json = rawJson
        }

        guard let type = json["type"] as? String else {
            print("[AgentClient] No 'type' field in JSON: \(json.keys)")
            return nil
        }

        switch type {
        case "text":
            let content = json["content"] as? String ?? ""
            return .text(content: content)

        case "tool_use":
            let toolName = json["toolName"] as? String ?? ""
            let toolInput: String
            if let inputData = try? JSONSerialization.data(withJSONObject: json["toolInput"] ?? [:]),
               let inputString = String(data: inputData, encoding: .utf8) {
                toolInput = inputString
            } else {
                toolInput = ""
            }
            return .toolUse(toolName: toolName, toolInput: toolInput)

        case "tool_result":
            let toolName = json["toolName"] as? String ?? ""
            let result: String
            if let resultValue = json["result"] {
                if let resultString = resultValue as? String {
                    result = resultString
                } else if let resultData = try? JSONSerialization.data(withJSONObject: resultValue),
                          let resultStr = String(data: resultData, encoding: .utf8) {
                    result = resultStr
                } else {
                    result = String(describing: resultValue)
                }
            } else {
                result = ""
            }
            return .toolResult(toolName: toolName, result: result)

        case "done":
            let conversationId = json["conversationId"] as? String ?? ""
            let messageId = json["messageId"] as? String ?? ""
            let usageDict = json["usage"] as? [String: Any] ?? [:]
            let usage = ChatUsage(
                inputTokens: usageDict["inputTokens"] as? Int ?? 0,
                outputTokens: usageDict["outputTokens"] as? Int ?? 0,
                totalCostUsd: usageDict["totalCostUsd"] as? Double ?? 0
            )
            return .done(conversationId: conversationId, messageId: messageId, usage: usage)

        case "error":
            let message = json["message"] as? String ?? "Unknown error"
            return .error(message: message)

        default:
            print("[AgentClient] Unhandled event type: \(type)")
            return nil
        }
    }
}
