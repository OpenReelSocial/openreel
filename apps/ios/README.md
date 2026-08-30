# OpenReel iOS

Native SwiftUI client. The Xcode project is generated, not committed — see
`.gitignore` and `AGENTS.md` § iOS Conventions.

## Setup

Requires [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```bash
cd apps/ios
xcodegen generate
open OpenReel.xcodeproj
```

Run from Xcode (`Cmd+R`) with an iOS Simulator destination selected.

Regenerate the project any time `project.yml` or the file layout under
`Sources/` changes.
