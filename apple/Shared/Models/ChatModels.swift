//
//  ChatModels.swift
//  Bap
//
//  Shared chat models for iOS and macOS
//

import Foundation

struct Chat: Identifiable, Codable, Hashable {
    let id: String
    let title: String?
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct Message: Identifiable, Codable, Hashable {
    let id: String
    let chatId: String
    let role: MessageRole
    let content: String
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case chatId = "chat_id"
        case role
        case content
        case createdAt = "created_at"
    }
}

enum MessageRole: String, Codable {
    case user
    case assistant
    case system
}

struct SendMessageRequest: Encodable {
    let chatId: String
    let content: String

    enum CodingKeys: String, CodingKey {
        case chatId = "chat_id"
        case content
    }
}

struct CreateChatResponse: Decodable {
    let id: String
}
