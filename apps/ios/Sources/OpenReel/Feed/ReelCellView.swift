import SwiftUI

struct ReelCellView: View {
    let reel: Reel
    let isActive: Bool

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            ReelPlayerView(url: reel.videoURL, isActive: isActive)

            VStack(alignment: .leading, spacing: 4) {
                Text(reel.authorHandle)
                    .font(.headline)
                Text(reel.caption)
                    .font(.subheadline)
            }
            .foregroundStyle(.white)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(
                    colors: [.black.opacity(0.65), .clear],
                    startPoint: .bottom,
                    endPoint: .top
                )
            )
        }
    }
}
