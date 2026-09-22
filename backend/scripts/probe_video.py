import sys
import os
import json
import subprocess

def probe_video(video_path, thumbnail_output_path):
    if not os.path.exists(video_path):
        return {"success": False, "error": f"Video file not found at {video_path}"}

    abs_video = os.path.abspath(video_path)
    abs_thumb = os.path.abspath(thumbnail_output_path)
    os.makedirs(os.path.dirname(abs_thumb), exist_ok=True)

    # 1. Run ffprobe to get video stream details
    try:
        probe_cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            abs_video
        ]
        result = subprocess.run(probe_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        data = json.loads(result.stdout)

        # Extract video stream
        video_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
        if not video_stream:
            return {"success": False, "error": "No video stream found in file"}

        width = int(video_stream.get("width", 1920))
        height = int(video_stream.get("height", 1080))
        try:
            raw_dur = data.get("format", {}).get("duration") or video_stream.get("duration")
            duration = float(raw_dur) if raw_dur is not None else 10.0
        except Exception:
            duration = 10.0

        # 2. Run ffmpeg to extract poster frame thumbnail
        # Pick thumbnail at 1s or half duration if shorter
        thumb_time = min(1.0, max(0.1, duration / 2.0))
        thumbnail_filename = None
        try:
            ffmpeg_cmd = [
                "ffmpeg",
                "-y",
                "-ss", str(thumb_time),
                "-i", abs_video,
                "-vframes", "1",
                "-q:v", "2",
                abs_thumb
            ]
            subprocess.run(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=30)
            thumbnail_filename = os.path.basename(abs_thumb)
        except Exception as fe:
            # Non-fatal if poster frame generation fails
            pass

        return {
            "success": True,
            "width": width,
            "height": height,
            "duration": round(duration, 2),
            "thumbnail": thumbnail_filename or ""
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: python probe_video.py <video_path> <thumbnail_output_path>"}))
        sys.exit(1)

    v_path = sys.argv[1]
    t_path = sys.argv[2]
    out = probe_video(v_path, t_path)
    print(json.dumps(out))
