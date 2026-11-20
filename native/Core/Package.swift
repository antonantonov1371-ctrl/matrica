// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "MatricaCore", platforms: [.macOS(.v14), .iOS(.v17)], products: [.library(name: "MatricaCore", targets: ["MatricaCore"])], targets: [.target(name: "MatricaCore"), .testTarget(name: "MatricaCoreTests", dependencies: ["MatricaCore"], resources: [.copy("Compatibility.json")])])
