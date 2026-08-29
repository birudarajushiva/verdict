import { useRef, useState } from 'react';
import { FileText, Trash2, Upload, X } from 'lucide-react';
import { uploadDocs } from '../api.ts';
import './DocUpload.css';

interface StagedDoc {
  name: string;
  text: string;
}

interface DocUploadProps {
  open: boolean;
  onClose: () => void;
  onAnalyze: () => void;
  notify: (msg: string) => void;
}

export default function DocUpload({ open, onClose, onAnalyze, notify }: DocUploadProps) {
  const [staged, setStaged] = useState<StagedDoc[]>([]);
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result ?? '');
        if (!text.trim()) return;
        setStaged((prev) => [...prev.filter((d) => d.name !== file.name), { name: file.name, text }]);
      };
      reader.readAsText(file);
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const addPaste = () => {
    if (!pasteText.trim()) return;
    const name = pasteName.trim() || `pasted_${staged.length + 1}.txt`;
    setStaged((prev) => [...prev.filter((d) => d.name !== name), { name, text: pasteText }]);
    setPasteText('');
    setPasteName('');
  };

  const remove = (name: string) => setStaged((prev) => prev.filter((d) => d.name !== name));

  const submit = async () => {
    if (staged.length === 0) return;
    setBusy(true);
    try {
      const res = await uploadDocs(staged);
      notify(`Uploaded ${res.written.length} document${res.written.length === 1 ? '' : 's'} — analyzing`);
      setStaged([]);
      onClose();
      onAnalyze();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="docupload-overlay" onClick={onClose}>
      <div className="docupload glass" onClick={(e) => e.stopPropagation()}>
        <div className="docupload-head">
          <h3>Upload case documents</h3>
          <button className="du-close" onClick={onClose} title="Close"><X size={16} /></button>
        </div>
        <p className="du-hint">
          Add your case as plain-text documents. The swarm analyzes them and puts supporting
          evidence on the <strong>For</strong> tab and opposing evidence on the <strong>Against</strong> tab.
        </p>

        <div className="du-row">
          <input ref={fileRef} type="file" accept=".txt,text/plain" multiple onChange={(e) => addFiles(e.target.files)} />
        </div>

        <div className="du-paste">
          <input
            type="text"
            placeholder="Document name (e.g. contract.txt)"
            value={pasteName}
            onChange={(e) => setPasteName(e.target.value)}
          />
          <textarea
            placeholder="…or paste the document text here"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={4}
          />
          <button className="du-add" onClick={addPaste} disabled={!pasteText.trim()}>Add pasted text</button>
        </div>

        {staged.length > 0 && (
          <div className="du-list">
            {staged.map((d) => (
              <div key={d.name} className="du-item">
                <FileText size={14} />
                <span className="du-name">{d.name}</span>
                <span className="du-size">{d.text.length} chars</span>
                <button className="du-remove" onClick={() => remove(d.name)} title="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="du-actions">
          <button className="du-cancel" onClick={onClose}>Cancel</button>
          <button className="du-submit" onClick={submit} disabled={busy || staged.length === 0}>
            <Upload size={15} /> {busy ? 'Uploading…' : `Upload & analyze (${staged.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
