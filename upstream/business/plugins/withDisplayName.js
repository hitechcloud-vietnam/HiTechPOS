const { withStringsXml, AndroidConfig } = require("expo/config-plugins");
// HiTechPOS: the Android launcher label differs from expo.name, which must stay
// ASCII because it also names the native projects.
module.exports = function withDisplayName(config, { name }) {
  if (typeof name !== "string" || !name.trim())
    throw new Error("withDisplayName needs a display name");
  return withStringsXml(config, (result) => {
    result.modResults = AndroidConfig.Strings.setStringItem(
      [
        AndroidConfig.Resources.buildResourceItem({
          name: "app_name",
          value: name,
        }),
      ],
      result.modResults,
    );
    return result;
  });
};
