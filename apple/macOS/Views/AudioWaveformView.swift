//
//  AudioWaveformView.swift
//  Bap
//
//  Animated waveform visualization that responds to audio levels
//

import SwiftUI

struct AudioWaveformView: View {
    let audioLevel: Float
    let barCount: Int
    let barSpacing: CGFloat
    let minBarHeight: CGFloat
    let maxBarHeight: CGFloat
    let barColor: Color

    @State private var barHeights: [CGFloat] = []
    @State private var targetHeights: [CGFloat] = []

    init(
        audioLevel: Float,
        barCount: Int = 5,
        barSpacing: CGFloat = 4,
        minBarHeight: CGFloat = 4,
        maxBarHeight: CGFloat = 24,
        barColor: Color = .red
    ) {
        self.audioLevel = audioLevel
        self.barCount = barCount
        self.barSpacing = barSpacing
        self.minBarHeight = minBarHeight
        self.maxBarHeight = maxBarHeight
        self.barColor = barColor
    }

    var body: some View {
        HStack(spacing: barSpacing) {
            ForEach(0..<barCount, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(barColor)
                    .frame(width: 4, height: barHeights.indices.contains(index) ? barHeights[index] : minBarHeight)
            }
        }
        .onAppear {
            initializeBars()
        }
        .onChange(of: audioLevel) { _, newLevel in
            updateBars(for: newLevel)
        }
    }

    private func initializeBars() {
        barHeights = Array(repeating: minBarHeight, count: barCount)
        targetHeights = Array(repeating: minBarHeight, count: barCount)
    }

    private func updateBars(for level: Float) {
        // Generate varied heights based on audio level with some randomness
        let baseHeight = minBarHeight + CGFloat(level) * (maxBarHeight - minBarHeight)

        withAnimation(.easeOut(duration: 0.08)) {
            barHeights = (0..<barCount).map { index in
                // Create variation - middle bars tend to be taller
                let centerIndex = CGFloat(barCount - 1) / 2.0
                let distanceFromCenter = abs(CGFloat(index) - centerIndex)
                let centerMultiplier = 1.0 - (distanceFromCenter / centerIndex) * 0.4

                // Add some randomness for more organic look
                let randomFactor = CGFloat.random(in: 0.7...1.3)

                let height = baseHeight * centerMultiplier * randomFactor
                return max(minBarHeight, min(maxBarHeight, height))
            }
        }
    }
}

#Preview("Waveform - Silent") {
    AudioWaveformView(audioLevel: 0.0)
        .frame(width: 100, height: 40)
        .background(Color.black.opacity(0.8))
}

#Preview("Waveform - Medium") {
    AudioWaveformView(audioLevel: 0.5)
        .frame(width: 100, height: 40)
        .background(Color.black.opacity(0.8))
}

#Preview("Waveform - Loud") {
    AudioWaveformView(audioLevel: 1.0)
        .frame(width: 100, height: 40)
        .background(Color.black.opacity(0.8))
}
