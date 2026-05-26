#!/bin/bash
# Fix viewer audio on iOS

F="app/(tabs)/more/my-church-room/messages/live-room.tsx"
cp "$F" "$F.bak_final_fix_$(date +%Y%m%d_%H%M%S)"

# Force audio to be true for all users
sed -i '' 's/audio={false}/audio={true}/g' "$F"

# Add polyfill for document to fix LiveKit error
python3 << 'PY'
from pathlib import Path
p = Path("app/(tabs)/more/my-church-room/messages/live-room.tsx")
s = p.read_text()

# Add document polyfill at the very top
polyfill = '''
// Polyfill for React Native (LiveKit requires document)
if (typeof document === 'undefined') {
  global.document = {
    createElement: () => ({ style: {}, appendChild: () => {}, addEventListener: () => {} }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}
'''

if 'global.document' not in s:
    s = polyfill + '\n' + s

# Add audio configuration with proper error handling
audio_config = '''
  // Configure audio for iOS viewers
  useEffect(() => {
    const setupAudio = async () => {
      if (Platform.OS === 'ios') {
        try {
          const { AudioSession } = await import('@livekit/react-native');
          await AudioSession.sharedInstance().configure({
            category: 'playAndRecord',
            mode: 'voiceChat',
            options: ['defaultToSpeaker', 'allowBluetooth'],
          });
          await AudioSession.sharedInstance().setActive(true);
          console.log('✅ Audio session configured');
        } catch (err) {
          console.log('Audio setup skipped:', err?.message);
        }
      }
    };
    setupAudio();
  }, []);
'''

if 'Audio session configured' not in s:
    # Add imports if missing
    if 'import { useEffect' not in s:
        s = s.replace('import React, {', 'import React, { useEffect, ')
    if 'import { Platform' not in s:
        s = s.replace('import { StyleSheet,', 'import { Platform, StyleSheet,')
    
    # Insert after component start
    if 'const LiveRoom = ' in s:
        s = s.replace('const LiveRoom = ', audio_config + '\nconst LiveRoom = ', 1)

p.write_text(s)
print("✅ Fixed: audio=true, document polyfill added, audio session configured")
PY

echo "✅ Done! Press 'r' in Metro terminal to reload"
