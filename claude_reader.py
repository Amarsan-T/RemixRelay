from dotenv import load_dotenv
from anthropic import Anthropic
import mido
import json

load_dotenv()
client = Anthropic()
model = "claude-haiku-4-5"

def midi_to_json(midi_path, json_path):
    # Load the MIDI file
    mid = mido.MidiFile(midi_path)

    # Initialize the main dictionary structure
    midi_data = {
        "ticks_per_beat": mid.ticks_per_beat,
        "length_seconds": mid.length,
        "tracks": [],
    }

    # Iterate through each track in the MIDI file
    for i, track in enumerate(mid.tracks):
        track_info = {"track_index": i, "name": tracgit k.name, "messages": []}

        # Parse every message/event in the track
        for msg in track:
            # Convert the mido message into a dictionary representation
            msg_dict = msg.dict()
            track_info["messages"].append(msg_dict)

        midi_data["tracks"].append(track_info)

    # Write the dictionary data into a structured JSON file
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(midi_data, f, indent=4)


# Example usage:
midi_to_json("your_song.mid", "your_song.json")