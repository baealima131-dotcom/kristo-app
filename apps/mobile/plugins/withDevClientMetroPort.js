const fs = require("fs");
const path = require("path");
const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");

const DEFAULT_METRO_PORT = "8084";
const PODFILE_MARKER = "# @kristo/dev-client-metro-port";
const POST_INSTALL_MARKER = "# @kristo/pin-rct-metro-port";

/** Pin RCT_METRO_PORT so the native dev client matches `expo start --port`. */
module.exports = function withDevClientMetroPort(config) {
  const metroPort = String(process.env.KRISTO_METRO_PORT || DEFAULT_METRO_PORT).trim();

  config = withXcodeProject(config, (configMod) => {
    const project = configMod.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const entry = configurations[key];
      if (typeof entry !== "object" || !entry.buildSettings) {
        continue;
      }
      entry.buildSettings.RCT_METRO_PORT = metroPort;
    }
    return configMod;
  });

  return withDangerousMod(config, [
    "ios",
    async (configMod) => {
      const iosRoot = configMod.modRequest.platformProjectRoot;
      const localEnvPath = path.join(iosRoot, ".xcode.env.local");
      const podfilePath = path.join(iosRoot, "Podfile");

      let lines = [];
      if (fs.existsSync(localEnvPath)) {
        lines = fs
          .readFileSync(localEnvPath, "utf8")
          .split("\n")
          .filter(
            (line) =>
              line.trim() &&
              !line.startsWith("export RCT_METRO_PORT=") &&
              !line.startsWith("export REACT_NATIVE_PACKAGER_HOSTNAME=")
          );
      }

      lines.push(`export RCT_METRO_PORT=${metroPort}`);
      lines.push(
        'export REACT_NATIVE_PACKAGER_HOSTNAME=$(/usr/sbin/ipconfig getifaddr en0 2>/dev/null || echo "localhost")'
      );
      fs.writeFileSync(localEnvPath, `${lines.join("\n")}\n`);

      if (fs.existsSync(podfilePath)) {
        let podfile = fs.readFileSync(podfilePath, "utf8");
        const podfileLine = `${PODFILE_MARKER}\nENV['RCT_METRO_PORT'] ||= '${metroPort}'`;

        if (!podfile.includes(PODFILE_MARKER)) {
          podfile = podfile.replace(
            "prepare_react_native_project!",
            `${podfileLine}\n\nprepare_react_native_project!`
          );
        } else {
          podfile = podfile.replace(
            /ENV\['RCT_METRO_PORT'\] \|\|= '\d+'/,
            `ENV['RCT_METRO_PORT'] ||= '${metroPort}'`
          );
        }

        const postInstallSnippet = `
    ${POST_INSTALL_MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        defs = build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS']
        next if defs.nil?
        if defs.is_a?(String)
          build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs.gsub(
            'RCT_METRO_PORT=\${RCT_METRO_PORT}',
            'RCT_METRO_PORT=${metroPort}'
          )
        elsif defs.is_a?(Array)
          build_config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs.map do |entry|
            entry.is_a?(String) ? entry.gsub('RCT_METRO_PORT=\${RCT_METRO_PORT}', 'RCT_METRO_PORT=${metroPort}') : entry
          end
        end
      end
    end`;

        if (!podfile.includes(POST_INSTALL_MARKER)) {
          podfile = podfile.replace(
            "react_native_post_install(\n      installer,\n      config[:reactNativePath],\n      :mac_catalyst_enabled => false,\n      :ccache_enabled => ccache_enabled?(podfile_properties),\n    )",
            `react_native_post_install(\n      installer,\n      config[:reactNativePath],\n      :mac_catalyst_enabled => false,\n      :ccache_enabled => ccache_enabled?(podfile_properties),\n    )${postInstallSnippet}`
          );
        } else {
          podfile = podfile.replace(
            /RCT_METRO_PORT=\\?\$\{RCT_METRO_PORT\}|RCT_METRO_PORT=\d+/g,
            `RCT_METRO_PORT=${metroPort}`
          );
        }

        fs.writeFileSync(podfilePath, podfile);
      }

      return configMod;
    },
  ]);
};
