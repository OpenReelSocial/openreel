#if DEBUG
import Foundation
import Network

/// Catches the OAuth redirect for the loopback development client. The atproto
/// profile lets a `http://localhost` client redirect to `http://127.0.0.1` on
/// any port, so this binds an ephemeral one, serves exactly one callback, and
/// shuts down. Debug builds only; a release build uses the custom URL scheme.
final class LoopbackRedirectListener: @unchecked Sendable {
    enum ListenerError: Error {
        case failedToStart(Error?)
        case closed
    }

    private let listener: NWListener
    private let path: String
    private let queue = DispatchQueue(label: "social.openreel.oauth-loopback")
    private let lock = NSLock()
    private var startContinuation: CheckedContinuation<UInt16, Error>?
    private var callbackContinuation: CheckedContinuation<URL, Error>?
    private var receivedCallback: URL?
    private var closed = false
    private var connections: [NWConnection] = []

    init(path: String) throws {
        self.path = path
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
        parameters.allowLocalEndpointReuse = true
        listener = try NWListener(using: parameters)
    }

    /// Starts listening and returns the port the system picked.
    func start() async throws -> UInt16 {
        try await withCheckedThrowingContinuation { continuation in
            lock.withLock { startContinuation = continuation }
            listener.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    if let port = self.listener.port?.rawValue {
                        self.resumeStart(.success(port))
                    } else {
                        self.resumeStart(.failure(ListenerError.failedToStart(nil)))
                    }
                case let .failed(error):
                    self.resumeStart(.failure(ListenerError.failedToStart(error)))
                    self.resumeCallback(.failure(ListenerError.failedToStart(error)))
                case .cancelled:
                    self.resumeStart(.failure(ListenerError.closed))
                    self.resumeCallback(.failure(ListenerError.closed))
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                self?.accept(connection)
            }
            listener.start(queue: queue)
        }
    }

    /// Resolves with the full redirect URL once the browser hits `path`.
    func callbackURL() async throws -> URL {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                // Settle immediately if the redirect already arrived or the
                // listener was already torn down (e.g. the task was cancelled
                // before we got here); otherwise park until one of those.
                let settled: Result<URL, Error>? = lock.withLock {
                    if let receivedCallback { return .success(receivedCallback) }
                    if closed || Task.isCancelled { return .failure(ListenerError.closed) }
                    callbackContinuation = continuation
                    return nil
                }
                if let settled { continuation.resume(with: settled) }
            }
        } onCancel: {
            stop()
        }
    }

    func stop() {
        let open: [NWConnection] = lock.withLock {
            closed = true
            return connections
        }
        listener.cancel()
        open.forEach { $0.cancel() }
        resumeCallback(.failure(ListenerError.closed))
    }

    // MARK: - Private

    private func accept(_ connection: NWConnection) {
        lock.withLock { connections.append(connection) }
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, _, error in
            guard let self else { return }
            guard error == nil, let data, let requestLine = String(data: data, encoding: .utf8)?
                .split(separator: "\r\n", maxSplits: 1).first
            else {
                connection.cancel()
                return
            }
            // "GET /oauth/callback?code=...&state=... HTTP/1.1"
            let parts = requestLine.split(separator: " ")
            guard parts.count >= 2, parts[0] == "GET",
                  let target = URL(string: "http://127.0.0.1:\(self.listener.port?.rawValue ?? 0)\(parts[1])"),
                  target.path == self.path
            else {
                self.respond(connection, status: "404 Not Found", body: "Not found.")
                return
            }
            self.respond(connection, status: "200 OK", body: "You can close this window and return to OpenReel.")
            self.resumeCallback(.success(target))
        }
    }

    private func respond(_ connection: NWConnection, status: String, body: String) {
        let html = "<!doctype html><html><body style=\"font-family:-apple-system;padding:2em\"><p>\(body)</p></body></html>"
        let response = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(html.utf8.count)\r\nConnection: close\r\n\r\n\(html)"
        connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func resumeStart(_ result: Result<UInt16, Error>) {
        let continuation = lock.withLock {
            defer { startContinuation = nil }
            return startContinuation
        }
        continuation?.resume(with: result)
    }

    private func resumeCallback(_ result: Result<URL, Error>) {
        let continuation: CheckedContinuation<URL, Error>? = lock.withLock {
            switch result {
            case let .success(url) where receivedCallback == nil:
                receivedCallback = url
            case .failure:
                closed = true
            default:
                break
            }
            defer { callbackContinuation = nil }
            return callbackContinuation
        }
        continuation?.resume(with: result)
    }
}
#endif
