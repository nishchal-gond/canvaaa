import sys
import os
import json
import pymupdf

# Target resolution for the main display (full 1080p)
DISPLAY_WIDTH = 1920

# Thumbnail resolution for admin panel previews (480x270 WebP/JPG)
# Much smaller: ~10x faster to load, ~5x less disk space
THUMB_WIDTH = 480


def parse_pages(pages_str, max_pages):
    """
    Parses a page range string like '1-5', '1,2,3', or '1-3,5'
    into a sorted list of 1-based page numbers.
    """
    if not pages_str or str(pages_str).strip() == "":
        return list(range(1, max_pages + 1))

    pages = set()
    parts = str(pages_str).split(",")
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            sub = part.split("-", 1)
            try:
                start = max(1, int(sub[0].strip()))
                end = min(max_pages, int(sub[1].strip()))
                for p in range(start, end + 1):
                    pages.add(p)
            except ValueError:
                pass
        else:
            try:
                p = int(part)
                if 1 <= p <= max_pages:
                    pages.add(p)
            except ValueError:
                pass

    res = sorted(list(pages))
    return res if res else list(range(1, max_pages + 1))


def render_pdf(pdf_path, output_dir, pages_str=None):
    if not os.path.exists(pdf_path):
        return {"success": False, "error": f"PDF not found at {pdf_path}"}

    os.makedirs(output_dir, exist_ok=True)
    thumb_dir = os.path.join(output_dir, "thumbs")
    os.makedirs(thumb_dir, exist_ok=True)

    try:
        doc = pymupdf.open(pdf_path)
        total_pages = len(doc)
        target_pages = parse_pages(pages_str, total_pages)
        slides = []

        for new_idx, page_num in enumerate(target_pages, start=1):
            page_index = page_num - 1  # 0-indexed for pymupdf
            if page_index < 0 or page_index >= total_pages:
                continue

            page = doc[page_index]
            rect = page.rect
            width_pts = rect.width
            height_pts = rect.height

            # ---- Full-res slide for 1080p / 4K display player (High quality JPG, ~5x smaller than PNG) ----
            scale = DISPLAY_WIDTH / width_pts if width_pts > 0 else 2.0
            scale = min(max(scale, 1.0), 3.0)
            mat = pymupdf.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=mat, alpha=False)

            filename = f"slide_{new_idx}.jpg"
            out_file = os.path.join(output_dir, filename)
            pix.save(out_file, output="jpg", jpg_quality=92)

            # ---- Fast thumbnail for admin preview grid (480px wide, ~20 KB) ----
            thumb_scale = THUMB_WIDTH / width_pts if width_pts > 0 else 0.5
            thumb_mat = pymupdf.Matrix(thumb_scale, thumb_scale)
            thumb_pix = page.get_pixmap(matrix=thumb_mat, alpha=False)

            thumb_filename = f"slide_{new_idx}.jpg"
            thumb_file = os.path.join(thumb_dir, thumb_filename)
            thumb_pix.save(thumb_file, output="jpg", jpg_quality=82)

            slides.append({
                "slide_index": new_idx,
                "original_page": page_num,
                "filename": filename,
                "thumb_filename": f"thumbs/{thumb_filename}",
                "width": pix.width,
                "height": pix.height,
                "thumb_width": thumb_pix.width,
                "thumb_height": thumb_pix.height
            })

        doc.close()
        return {
            "success": True,
            "page_count": len(slides),
            "slides": slides
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: python render_pdf.py <pdf_path> <output_dir> [pages_range]"}))
        sys.exit(1)

    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    pages_arg = sys.argv[3] if len(sys.argv) > 3 else None
    result = render_pdf(pdf_path, output_dir, pages_arg)
    print(json.dumps(result))
