from dotenv import load_dotenv
from anthropic import Anthropic
import mido
import json
import os

load_dotenv()
client = Anthropic(default_headers={"anthropic-workspace-id": "wrkspc_01EMEeaL7veZGXh6RaB2GwpK"})
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
        track_info = {"track_index": i, "name": track.name, "messages": []}

        # Parse every message/event in the track
        for msg in track:
            # Convert the mido message into a dictionary representation
            msg_dict = msg.dict()
            track_info["messages"].append(msg_dict)

        midi_data["tracks"].append(track_info)

    # Write the dictionary data into a structured JSON file
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(midi_data, f, indent=4)

def claude_read_midi(midi_path, json_path):
    midi_to_json(midi_path, json_path)
    with open(json_path, 'r', encoding='utf-8') as f:
        json_data = json.load(f)
    #os.remove(json_path)

    json_string = json.dumps(json_data, indent=2)
    user_messages = [{
        "role": "user",
        "content": "The following is a MIDI file converted to a JSON file. "
                "Give insights on how it can be musically improved:\n\n"
                f"```json\n{json_string}\n```"
    }]

    answer = client.messages.create(
        model=model,
        max_tokens=1000,
        messages=user_messages
    )

    analysis_text = answer.content[0].text

    with open("midi_analysis.md", "w", encoding="utf-8") as f:
        f.write(analysis_text)

    print("Analysis saved to midi_analysis.md!")


claude_read_midi("./Example/MIDI_sample.mid", "sample.json")
