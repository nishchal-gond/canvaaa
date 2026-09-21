import sys
import os
import json
import re

def render_pptx(pptx_path, output_dir):
    if not os.path.exists(pptx_path):
        return {"success": False, "error": f"PPTX file not found at {pptx_path}"}

    os.makedirs(output_dir, exist_ok=True)
    abs_pptx_path = os.path.abspath(pptx_path)
    abs_output_dir = os.path.abspath(output_dir)

    ppt = None
    pres = None
    try:
        import win32com.client
        import pythoncom

        # Initialize COM in this thread
        pythoncom.CoInitialize()

        # Connect to PowerPoint Application
        ppt = win32com.client.Dispatch('PowerPoint.Application')
        pres = ppt.Presentations.Open(abs_pptx_path, ReadOnly=True, Untitled=False, WithWindow=False)

        slide_count = pres.Slides.Count
        if slide_count == 0:
            return {"success": False, "error": "Presentation contains no slides."}

        # Export all slides as 1920x1080 PNG
        pres.Export(abs_output_dir, "PNG", 1920, 1080)

        # Standardize slide file names (PowerPoint exports as Slide1.PNG, Slide2.PNG etc.)
        slides = []
        for i in range(1, slide_count + 1):
            default_name = f"Slide{i}.PNG"
            default_path = os.path.join(abs_output_dir, default_name)
            target_name = f"slide_{i}.png"
            target_path = os.path.join(abs_output_dir, target_name)

            if os.path.exists(default_path):
                if os.path.exists(target_path) and target_path.lower() != default_path.lower():
                    os.remove(target_path)
                os.rename(default_path, target_path)

            slides.append({
                "slide_index": i,
                "filename": target_name,
                "width": 1920,
                "height": 1080
            })

        return {
            "success": True,
            "page_count": slide_count,
            "slides": slides
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
    finally:
        try:
            if pres:
                pres.Close()
        except:
            pass
        try:
            if ppt:
                ppt.Quit()
        except:
            pass
        try:
            pythoncom.CoUninitialize()
        except:
            pass

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: python render_pptx.py <pptx_path> <output_dir>"}))
        sys.exit(1)

    pptx_path = sys.argv[1]
    output_dir = sys.argv[2]
    result = render_pptx(pptx_path, output_dir)
    print(json.dumps(result))
