import sys
import os
import json
import pymupdf

def render_pdf(pdf_path, output_dir):
    if not os.path.exists(pdf_path):
        return {"success": False, "error": f"PDF not found at {pdf_path}"}

    os.makedirs(output_dir, exist_ok=True)

    try:
        doc = pymupdf.open(pdf_path)
        page_count = len(doc)
        slides = []

        # Target 1080p standard: 1920x1080
        # If PDF page is standard 16:9 (e.g. 72dpi: 960x540 or 1920x1080 points)
        # We calculate dpi scale or use dpi=150 (approx 2000px wide for standard slide)
        for i in range(page_count):
            page = doc[i]
            rect = page.rect
            width_pts = rect.width
            height_pts = rect.height

            # Calculate zoom factor to achieve ~1920px width minimum
            scale = 1920.0 / width_pts if width_pts > 0 else 2.0
            # Cap scale for memory/performance
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
        return {
            "success": True,
            "page_count": page_count,
            "slides": slides
        }
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: python render_pdf.py <pdf_path> <output_dir>"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    result = render_pdf(pdf_path, output_dir)
    print(json.dumps(result))
