import OpenReelATProto
import SwiftUI

/// Reports a reel or its author (`com.atproto.moderation.createReport`).
/// Opened from the reel's action fan.
struct ReportView: View {
    let reel: Reel
    let moderation: ModerationController

    private enum Subject: Hashable {
        case video, account
    }

    @Environment(\.dismiss) private var dismiss
    @State private var subject = Subject.video
    @State private var reason: ReportReason?
    @State private var details = ""
    @State private var isSending = false
    @State private var errorMessage: String?
    @State private var didSend = false

    var body: some View {
        NavigationStack {
            Group {
                if didSend {
                    sent
                } else {
                    form
                }
            }
            .navigationTitle("Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if didSend {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                } else {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        if isSending {
                            ProgressView()
                        } else {
                            Button("Send", action: send)
                                .disabled(reason == nil)
                        }
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSending)
    }

    private var form: some View {
        Form {
            Section("What are you reporting?") {
                Picker("Subject", selection: $subject) {
                    Text("This video").tag(Subject.video)
                    Text(reel.authorHandle).tag(Subject.account)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            }

            Section("What's wrong with it?") {
                ForEach(ReportReason.allCases) { option in
                    Button {
                        reason = option
                    } label: {
                        HStack {
                            Text(option.title)
                                .foregroundStyle(MonoTheme.primary)
                            Spacer()
                            if reason == option {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(MonoTheme.primary)
                            }
                        }
                    }
                    .accessibilityAddTraits(reason == option ? .isSelected : [])
                }
            }

            Section {
                TextField("Add details (optional)", text: $details, axis: .vertical)
                    .lineLimit(3...6)
            } footer: {
                Text(destination)
            }

            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
            }
        }
        .disabled(isSending)
    }

    private var sent: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.shield")
                .font(.system(size: 48, weight: .light))
            Text("Thanks for keeping OpenReel safe.")
                .font(.title3.weight(.bold))
                .multilineTextAlignment(.center)
            Text("Moderators will review it. Reports are private; \(reel.authorHandle) isn't told who sent one.")
                .font(.subheadline)
                .foregroundStyle(MonoTheme.secondary)
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(MonoTheme.primary)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var destination: String {
        moderation.baselineLabelerDID == nil
            ? "Your report goes to your server's moderators."
            : "Your report goes to OpenReel Moderation through your server."
    }

    private func send() {
        guard let reason else { return }
        let target: ReportSubject = switch subject {
        case .video: .record(reel.strongRef)
        case .account: .account(did: reel.authorDID)
        }
        isSending = true
        errorMessage = nil
        Task {
            do {
                try await moderation.report(target, reason: reason, details: details)
                didSend = true
            } catch {
                print("[report] could not send: \(error)")
                errorMessage = ModerationController.message(forReportError: error)
            }
            isSending = false
        }
    }
}
