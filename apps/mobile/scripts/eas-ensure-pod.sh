#!/usr/bin/env bash
# EAS Install pods does spawn('pod') with ctx.env only. Force a known-good PATH for
# later phases via __EAS_BUILD_ENVS_DIR (merged at end of each phase) and drop an
# absolute-path pod shim into the EAS workingdir/bin (prepended at context init).
set -euo pipefail

echo "== eas-ensure-pod: start =="
echo "PWD=$PWD"
echo "EAS_BUILD_RUNNER=${EAS_BUILD_RUNNER:-}"
echo "PATH=${PATH:-}"
echo "__EAS_BUILD_ENVS_DIR=${__EAS_BUILD_ENVS_DIR:-}"
echo "which pod (shell): $(command -v pod || echo NONE)"

resolve_pod() {
  # Prefer real CocoaPods installs over our own shims (avoid recursive wrappers).
  local candidate
  for candidate in \
    /opt/homebrew/bin/pod \
    /Users/expo/.gems/arm64/bin/pod \
    /Users/expo/.gems/bin/pod \
    /usr/local/bin/pod \
    "$HOME/.gems/arm64/bin/pod" \
    "$HOME/.gem/bin/pod"
  do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  if command -v pod >/dev/null 2>&1; then
    command -v pod
    return 0
  fi
  if command -v find >/dev/null 2>&1; then
    find /Users/expo/.gems /opt/homebrew /usr/local "$HOME/.gem" /Library/Ruby 2>/dev/null \
      -type f -name pod 2>/dev/null | head -n 1 || true
  fi
}

POD_BIN="$(resolve_pod || true)"
if [ -z "${POD_BIN:-}" ] || [ ! -x "$POD_BIN" ]; then
  echo "Installing cocoapods 1.16.2 via gem..."
  gem install cocoapods -v 1.16.2 -N
  POD_BIN="$(resolve_pod || true)"
fi
if [ -z "${POD_BIN:-}" ] || [ ! -x "$POD_BIN" ]; then
  echo "ERROR: could not locate pod binary"
  exit 1
fi
echo "Resolved pod: $POD_BIN"
"$POD_BIN" --version || true

WORKING_BIN=""
if [ -n "${__EAS_BUILD_ENVS_DIR:-}" ] && [ -d "$(dirname "$__EAS_BUILD_ENVS_DIR")" ]; then
  WORKING_BIN="$(dirname "$__EAS_BUILD_ENVS_DIR")/bin"
fi

write_pod_shim() {
  local dest_dir="$1"
  if [ -z "$dest_dir" ]; then
    return 0
  fi
  if ! mkdir -p "$dest_dir" 2>/dev/null; then
    echo "Skip (mkdir failed): $dest_dir"
    return 0
  fi
  if ! cat >"$dest_dir/pod" <<EOF
#!/bin/bash
exec "$POD_BIN" "\$@"
EOF
  then
    echo "Skip (write failed): $dest_dir/pod"
    return 0
  fi
  chmod +x "$dest_dir/pod" || true
  echo "Wrote $dest_dir/pod -> $POD_BIN"
  ls -la "$dest_dir/pod" || true
}

write_pod_shim "$WORKING_BIN"
write_pod_shim "$HOME/bin"
write_pod_shim "/Users/expo/bin"
if [ "${EAS_BUILD_RUNNER:-}" = "eas-build" ]; then
  write_pod_shim "/usr/local/bin"
fi

# Force PATH for subsequent EAS phases (Install pods). Merged at phase end.
FORCED_PATH="/Users/princefariji/bin:/Users/expo/bin:${WORKING_BIN:+$WORKING_BIN:}/opt/homebrew/bin:/Users/expo/.gems/arm64/bin:/Users/expo/.gems/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if [ -n "${__EAS_BUILD_ENVS_DIR:-}" ]; then
  mkdir -p "$__EAS_BUILD_ENVS_DIR"
  # Prefer official set-env helper when present.
  if [ -n "$WORKING_BIN" ] && [ -x "$WORKING_BIN/set-env" ]; then
    "$WORKING_BIN/set-env" PATH "$FORCED_PATH" || printf '%s' "$FORCED_PATH" >"$__EAS_BUILD_ENVS_DIR/PATH"
  else
    printf '%s' "$FORCED_PATH" >"$__EAS_BUILD_ENVS_DIR/PATH"
  fi
  echo "Queued PATH for next phases: $FORCED_PATH"
fi

export PATH="$FORCED_PATH"
hash -r 2>/dev/null || true
echo "verify which pod: $(command -v pod || echo NONE)"
pod --version
echo "== eas-ensure-pod: done =="
