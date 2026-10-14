const { withMainActivity, withAppDelegate } = require("expo/config-plugins");
module.exports = function withBusinessNavigation(config) {
  config = withAppDelegate(config, (result) => {
    if (result.modResults.language !== "swift")
      throw new Error("Business privacy expects Swift AppDelegate");
    let source = result.modResults.contents;
    if (!source.includes("private var businessPrivacyCover")) {
      const anchor = "class AppDelegate: ExpoAppDelegate {";
      if (
        !source.includes(anchor) ||
        source.includes("func applicationWillResignActive") ||
        source.includes("func applicationDidBecomeActive") ||
        source.includes("func applicationDidEnterBackground")
      )
        throw new Error(
          "Review AppDelegate lifecycle before configuring Business privacy",
        );
      if (!source.includes("import UIKit")) source = "import UIKit\n" + source;
      source = source.replace(
        anchor,
        anchor +
          `
  private var businessPrivacyCover: UIView?

  private func coverBusinessWindow() {
    guard let window = window else { return }
    if let cover = businessPrivacyCover {
      window.bringSubviewToFront(cover)
      return
    }
    let cover = UIView(frame: window.bounds)
    cover.backgroundColor = UIColor.systemBackground
    cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    cover.accessibilityElementsHidden = true
    window.addSubview(cover)
    businessPrivacyCover = cover
  }

  public override func applicationWillResignActive(_ application: UIApplication) {
    coverBusinessWindow()
    super.applicationWillResignActive(application)
  }

  public override func applicationDidEnterBackground(_ application: UIApplication) {
    coverBusinessWindow()
    super.applicationDidEnterBackground(application)
  }

  public override func applicationDidBecomeActive(_ application: UIApplication) {
    super.applicationDidBecomeActive(application)
    businessPrivacyCover?.removeFromSuperview()
    businessPrivacyCover = nil
  }
`,
      );
    }
    result.modResults.contents = source;
    return result;
  });
  return withMainActivity(config, (result) => {
    if (result.modResults.language !== "kt")
      throw new Error("Business navigation expects Kotlin MainActivity");
    let source = result.modResults.contents;
    const factory =
      "supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()";
    if (!source.includes(factory)) {
      if (!source.includes("super.onCreate(null)"))
        throw new Error(
          "Review MainActivity restoration before configuring navigation",
        );
      source = source.replace(
        "import android.os.Bundle",
        "import android.os.Bundle\nimport com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory",
      );
      source = source.replace(
        "super.onCreate(null)",
        factory + "\n    super.onCreate(null)",
      );
    }
    if (!source.includes("setRecentsScreenshotEnabled(false)")) {
      if (!source.includes("import android.os.Build"))
        source = source.replace(
          "import android.os.Bundle",
          "import android.os.Build\nimport android.os.Bundle",
        );
      source = source.replace(
        "super.onCreate(null)",
        "super.onCreate(null)\n    if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false)",
      );
    }
    result.modResults.contents = source;
    return result;
  });
};
