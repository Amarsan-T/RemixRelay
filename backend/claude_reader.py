from dotenv import load_dotenv
from anthropic import Anthropic
import mido
import json
import textwrap
import os

load_dotenv()
client = Anthropic(default_headers={"anthropic-workspace-id": "wrkspc_01EMEeaL7veZGXh6RaB2GwpK"})
model = "claude-haiku-4-5"

tools = [
    {
  "name": "trimTrack",
  "description": "Trims a single track of a MIDI file so it ends at a given tick position. Messages are accumulated by their delta times, and every message after the cumulative tick count exceeds max_ticks is dropped. Other tracks are left untouched. Returns the trimmed file's location and a summary of the change. Note that ticks are not seconds: real duration depends on the file's ticks_per_beat and tempo.",
  "input_schema": {
    "type": "object",
    "properties": {
      "midi_path": {
        "type": "string",
        "description": "Path to the source MIDI file (.mid or .midi)."
      },
      "track_num": {
        "type": "integer",
        "minimum": 0,
        "description": "Zero-based index of the track to trim. Track 0 is often a tempo/meta track in Type 1 MIDI files."
      },
      "max_ticks": {
        "type": "integer",
        "minimum": 0,
        "description": "Maximum cumulative tick position to keep. Messages whose absolute time exceeds this value are removed."
      },
      "output_path": {
        "type": "string",
        "description": "Where to save the trimmed MIDI file. If omitted, the original file is not overwritten and a default path such as '<original>_trimmed.mid' is used."
      }
    },
    "required": ["midi_path", "track_num", "max_ticks"]
  }
}
]

def trimTrack(midi_path, track_num, max_ticks):
    mid = mido.MidiFile(midi_path)
    track = mid.tracks[track_num]

    # Define your limit in ticks (e.g., 9600 ticks)
    # Note: ticks per beat * beats per second determines actual time length

    current_ticks = 0
    trimmed_track = mido.MidiTrack()

    for msg in track:
        current_ticks += msg.time
        
        # Stop adding messages once we cross the tick limit
        if current_ticks > max_ticks:
            break
           
        trimmed_track.append(msg)

    # Replace the old track with the trimmed one
    mid.tracks[track_num] = trimmed_track
    mid.save("output.mid")
    return {
        "output_path": "output.mid",
        "track_num": track_num,
        "messages_remaining": len(mid.tracks[track_num]),
    }

TOOL_HANDLERS = {
    "trimTrack": trimTrack
}

#input: 
# midi_path - path to midi file to convert
# json_path - path to output json file
#converts mid file at midi_path into json file outputted at json_path
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

#input:
# midi_path - path to midi file to convert
#output:
# stringified midi file  (midi -> json -> string) 
def midiToString(midi_path):
    json_path = "conversion.json"
    midi_to_json(midi_path, json_path)
    with open(json_path, 'r', encoding='utf-8') as f:
        json_data = json.load(f)
    os.remove(json_path)
    return json.dumps(json_data, indent=2)

def claude_inquire(midi_path, inquiry="", max_turns=10):
    json_string = midiToString(midi_path)

    if inquiry:
        task = f"Identify one way that the {inquiry} can be improved musically."
    else:
        task = "Identify one way that it can be improved musically."

    plan_prompt = textwrap.dedent(f"""\
        I have a MIDI file at {midi_path}. Here is the file converted into a JSON string:

        ```json
        {json_string}
        ```

        {task}
        
        """)

    messages = [{"role": "user", "content": plan_prompt}]

    response = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=messages,
    )

    messages.append({"role": "assistant", "content": response.content})
    print("PLAN:\n", "\n".join(b.text for b in response.content if b.type == "text"))

    messages.append({"role": "user", "content": textwrap.dedent(f"""\
        Now use the tools available to you to implement the changes from your plan
        to the MIDI file at {midi_path}. Rules:
        - Do not overwrite the original file. Always set `output_path` to a new file.
        - If you make several changes, chain them: use the output of one call as the
          `midi_path` of the next.

        When you're done, explain which tool calls you made and why, and where the
        final file was saved.
        """)})

    for _ in range(max_turns):
        response = client.messages.create(
            model=model,
            max_tokens=1024,
            messages=messages,
            tools=tools,
        )
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason != "tool_use":
            break

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            print(f"Tool selected: {block.name}  args: {block.input}")
            try:
                result = TOOL_HANDLERS[block.name](**block.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": json.dumps(result),
                })
            except Exception as e:
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": f"Error: {e}",
                    "is_error": True,
                })
        messages.append({"role": "user", "content": tool_results})
    else:
        print(f"Stopped after {max_turns} turns without a final answer.")

    final_text = "\n".join(b.text for b in response.content if b.type == "text")
    print("RESULT:\n", final_text)
    return final_text, messages
# claude_inquire("../Example/MIDI_sample.mid", inquiry="length")

def beginInquiry(inquiry, convo=None):
    messages = []
    messages.append({"role": "user", "content": inquiry})
    response = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=messages,
        system="""You are a introductory chat bot to an online music synthesizer, 
                which includes features like a piano roll and a step synthesizer. 
                Given the user inquiry about what music they would like to make, 
                make a suggestion for them to start with either the piano roll
                or the step synthesizer, and why."""
    )
    answer = response.content[0].text

    return {"role": "assistant","content": answer}

def AI_assist(inquiry, convo=None):
    messages = []
    if convo:
        messages += convo
    messages.append({"role": "user", "content": inquiry})
    response = client.messages.create(
        model=model,
        max_tokens=1024,
        messages=messages,
        system="Give step-by-step, easy-to-understand instructions"
    )
    answer = response.content[0].text
    return {"role": "assistant", "content": answer}

#claude_inquire("./Example/MIDI_sample.mid", "sample.json")
