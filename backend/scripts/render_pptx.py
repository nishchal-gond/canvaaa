import sys
import os
import json
import shutil
import subprocess
import glob

def render_pptx_with_libreoffice(pptx_path, output_dir):
    soffice_cmd = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice_cmd:
        for candidate in ["/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/lib/libreoffice/program/soffice"]:
            if os.path.exists(candidate):
                soffice_cmd = candidate
                break

    if not soffice_cmd:
        return {
            "success": False,
            "error": "LibreOffice is not installed on this server. For instant 1-second cloud processing, export from Canva as 'PDF Standard' or 'MP4 Video'!"
        }

    try:
        cmd = [
            soffice_cmd,
            "--headless",
            "--convert-to", "pdf",
            pptx_path,
            "--outdir", output_dir
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=120)
        if res.returncode != 0:
            return {"success": False, "error": f"LibreOffice conversion failed: {res.stderr or res.stdout}"}

        base_name = os.path.splitext(os.path.basename(pptx_path))[0]
        expected_pdf = os.path.join(output_dir, f"{base_name}.pdf")

        if not os.path.exists(expected_pdf):
            pdfs = glob.glob(os.path.join(output_dir, "*.pdf"))
            if not pdfs:
                return {"success": False, "error": f"Converted PDF not found in {output_dir}"}
            expected_pdf = pdfs[0]

        import pymupdf
        doc = pymupdf.open(expected_pdf)
        page_count = len(doc)
        if page_count == 0:
            doc.close()
            return {"success": False, "error": "Presentation contains no pages."}

        slides = []
        for i in range(page_count):
            page = doc[i]
            rect = page.rect
            width_pts = rect.width
            scale = 1920.0 / width_pts if width_pts > 0 else 2.0
            scale = min(max(scale, 1.0), 3.0)

            mat = pymupdf.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=mat, alpha=False)

            filename = f"slide_{i + 1}.png"
            out_file = os.path.join(output_dir, filename)
            pix.save(out_file)

            slides.append({
                "slide_index": i + 1,
                "filename": filename,
                "width": pix.width,
                "height": pix.height
            })

        doc.close()
        try:
            os.remove(expected_pdf)
        except Exception:
            pass

        return {
            "success": True,
            "page_count": page_count,
            "slides": slides
        }
    except Exception as e:
        return {"success": False, "error": f"LibreOffice PDF processing failed: {str(e)}"}

def render_pptx(pptx_path, output_dir):
    if not os.path.exists(pptx_path):
        return {"success": False, "error": f"PPTX file not found at {pptx_path}"}

    os.makedirs(output_dir, exist_ok=True)
    abs_pptx_path = os.path.abspath(pptx_path)
    abs_output_dir = os.path.abspath(output_dir)

    # 1. On Windows, try native PowerPoint COM first if available
    if sys.platform == 'win32':
        ppt = None
        pres = None
        try:
            import win32com.client
            import pythoncom

            pythoncom.CoInitialize()
            ppt = win32com.client.Dispatch('PowerPoint.Application')
            pres = ppt.Presentations.Open(abs_pptx_path, ReadOnly=True, Untitled=False, WithWindow=False)

            slide_count = pres.Slides.Count
            if slide_count == 0:
                return {"success": False, "error": "Presentation contains no slides."}

            pres.Export(abs_output_dir, "PNG", 1920, 1080)

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
        except Exception:
            pass  # Fallback to LibreOffice below
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

    # 2. Fallback to headless LibreOffice (standard for Linux containers like Render / Docker)
    return render_pptx_with_libreoffice(abs_pptx_path, abs_output_dir)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: python render_pptx.py <pptx_path> <output_dir>"}))
        sys.exit(1)

    pptx_path = sys.argv[1]
    output_dir = sys.argv[2]
    result = render_pptx(pptx_path, output_dir)
    print(json.dumps(result))

