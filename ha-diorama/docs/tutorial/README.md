# Tutorial

A five minute walkthrough that builds a small home from an empty card: two rooms, a lamp and a ceiling fan linked to real devices, a sofa, a door and a bed, a camera view for each room, and the side panel with its widgets.

- [tutorial.mp4](tutorial.mp4) is the finished video, with the voiceover.
- [script.json](script.json) is the script: for each scene, what is on screen and what the voice says.
- [clips/](clips) holds the raw take of each scene, uncut and without sound, named after the scene in the script.

## How it was made

Each scene was recorded in one take against a local Home Assistant, with the card built from this repository. The cursor moves and the typing are scripted, at a human pace.

The voice is generated from the script with the open Kokoro text-to-speech model, voice `af_heart`, at normal speed. Each line is anchored to the moment on screen it talks about. The edit then cuts the idle stretches out of each take, slows or holds the picture where a line needs more time, and crossfades between scenes.

To change a line, edit it in the script, generate its audio again and rebuild the scene it belongs to. To change what is on screen, record that scene's take again.

## Credits

The approach borrows from [screencast-studio](https://github.com/Argentron-Technologies/screencast-studio) and the [ui-demo skill](https://github.com/affaan-m/everything-claude-code/tree/main/skills/ui-demo).
