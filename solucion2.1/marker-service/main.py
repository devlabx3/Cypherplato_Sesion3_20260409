import os
import re
import tempfile
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from marker.config.parser import ConfigParser
from marker.converters.pdf import PdfConverter
from marker.models import create_model_dict

app_state: dict = {}

SKIP_TYPES = {"PageHeader", "PageFooter", "Picture", "Figure", "FigureGroup"}


def strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html or "").strip()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Carga todos los modelos ML una sola vez al arrancar (surya, torch, etc.)
    app_state["models"] = create_model_dict()
    yield
    app_state.clear()


app = FastAPI(title="marker-pdf extraction service", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "models_loaded": "models" in app_state}


@app.post("/extract")
async def extract(file: UploadFile = File(...)):
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file upload")

    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    try:
        tmp.write(contents)
        tmp.flush()
        tmp.close()

        options = {
            "output_format": "chunks",
            "use_llm": True,
            "llm_service": "marker.services.gemini.GoogleGeminiService",
            "gemini_model_name": "gemini-2.5-flash-lite",
            "pdftext_workers": 1,
        }
        config_parser = ConfigParser(options)
        config_dict = config_parser.generate_config_dict()

        # generate_config_dict() copia GOOGLE_API_KEY → gemini_api_key,
        # pero lo seteamos explícitamente como red de seguridad.
        if not config_dict.get("gemini_api_key"):
            config_dict["gemini_api_key"] = os.environ.get("GOOGLE_API_KEY", "")

        converter = PdfConverter(
            config=config_dict,
            artifact_dict=app_state["models"],
            processor_list=config_parser.get_processors(),
            renderer=config_parser.get_renderer(),   # workaround bug #906
            llm_service=config_parser.get_llm_service(),
        )
        rendered = converter(tmp.name)

        # Convert structured output to dictionary (Pydantic model compatibility)
        if hasattr(rendered, "model_dump"):
            rendered_data = rendered.model_dump()
        elif hasattr(rendered, "dict"):
            rendered_data = rendered.dict()
        else:
            rendered_data = rendered

        # Con output_format="chunks", rendered_data puede ser lista directa o dict con "children"
        raw_blocks = rendered_data if isinstance(rendered_data, list) else rendered_data.get("children", [])

        chunks = []
        for block in raw_blocks:
            btype = block.get("block_type", "")
            if btype in SKIP_TYPES:
                continue
            text = strip_html(block.get("html", ""))
            if not text:
                continue
            chunks.append({
                "text": text,
                "block_type": btype,
                "page_num": block.get("page", block.get("page_num", 0)),
            })

        return JSONResponse({"chunks": chunks})

    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
