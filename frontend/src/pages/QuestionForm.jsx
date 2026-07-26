import { useEffect, useState } from "react";

const timeOptions = [5, 10, 15, 20, 30, 45, 60, 90, 120];

export default function QuestionForm({ quizId, question, defaultTimeLimitSeconds = 30, onSaved, onCancel }) {
  const uploadId = `question-image-${question?.id ?? "new"}`;
  const defaultOptions = () => question?.options?.map((option) => ({ text: option.text, isCorrect: option.isCorrect })) ?? [{ text: "", isCorrect: true }, { text: "", isCorrect: false }];
  const [text, setText] = useState(question?.text ?? "");
  const [imageUrl, setImageUrl] = useState(question?.imageUrl ?? null);
  const [file, setFile] = useState(null);
  const [type, setType] = useState(question?.type ?? "SINGLE_CHOICE");
  const [timeLimitSeconds, setTimeLimitSeconds] = useState(question?.timeLimitSeconds ?? defaultTimeLimitSeconds);
  const [options, setOptions] = useState(defaultOptions);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(question?.text ?? "");
    setImageUrl(question?.imageUrl ?? null);
    setFile(null);
    setType(question?.type ?? "SINGLE_CHOICE");
    setTimeLimitSeconds(question?.timeLimitSeconds ?? defaultTimeLimitSeconds);
    setOptions(defaultOptions());
  }, [question, defaultTimeLimitSeconds]);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    let uploaded = imageUrl;

    if (file) {
      const formData = new FormData();
      formData.append("image", file);
      const uploadResponse = await fetch("/api/uploads/questions", { method: "POST", credentials: "include", body: formData });
      const uploadBody = await uploadResponse.json();
      if (!uploadResponse.ok) {
        setError(uploadBody.error?.message ?? "Не удалось загрузить изображение");
        setSaving(false);
        return;
      }
      uploaded = uploadBody.data.imageUrl;
    }

    const response = await fetch(question ? `/api/questions/${question.id}` : `/api/quizzes/${quizId}/questions`, {
      method: question ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ text, imageUrl: uploaded, type, timeLimitSeconds: Number(timeLimitSeconds), options, ...(question ? { position: question.position } : {}) }),
    });
    const body = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(body.error?.message ?? "Не удалось сохранить вопрос");
      return;
    }
    onSaved(body.data.question);
  };

  return <form className="question-form" onSubmit={submit}>
    <div className="question-form-heading">
      <div><p className="eyebrow">Конструктор</p><h3>{question ? "Редактирование вопроса" : "Новый вопрос"}</h3></div>
      <label className="question-time-limit">Время на вопрос
        <select value={timeLimitSeconds} onChange={(event) => setTimeLimitSeconds(Number(event.target.value))}>
          {timeOptions.map((seconds) => <option key={seconds} value={seconds}>{seconds} сек.</option>)}
        </select>
      </label>
    </div>
    <label>Текст вопроса<textarea value={text} onChange={(event) => setText(event.target.value)} required /></label>
    <div className="image-upload-section"><span>Изображение <small>необязательно</small></span><input id={uploadId} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><label className="image-upload-control" htmlFor={uploadId}><span className="image-upload-icon" aria-hidden="true">▧</span><span><strong>{file?.name ?? "Добавить изображение"}</strong><small>{file ? "Файл выбран и будет загружен при сохранении" : "JPG, PNG или WebP"}</small></span></label></div>
    {imageUrl && <img src={imageUrl} alt="Предпросмотр" className="question-image" />}
    <label>Тип<select value={type} onChange={(event) => setType(event.target.value)}><option value="SINGLE_CHOICE">Один правильный ответ</option><option value="MULTIPLE_CHOICE">Несколько правильных ответов</option></select></label>
    <div className="question-options"><h3>Варианты ответов</h3>{options.map((option, index) => <div className="option-row" key={index}><input aria-label={`Вариант ${index + 1}`} value={option.text} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))} required /><label><input type={type === "SINGLE_CHOICE" ? "radio" : "checkbox"} name="correct" checked={option.isCorrect} onChange={() => setOptions((current) => current.map((item, itemIndex) => ({ ...item, isCorrect: type === "SINGLE_CHOICE" ? itemIndex === index : itemIndex === index ? !item.isCorrect : item.isCorrect })))} /> правильный</label>{options.length > 2 && <button className="option-remove-button" type="button" onClick={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Удалить</button>}</div>)}</div>
    {options.length < 6 && <button className="add-option-button" type="button" onClick={() => setOptions((current) => [...current, { text: "", isCorrect: false }])}>+ Добавить вариант</button>}
    {error && <p className="form-alert" role="alert">{error}</p>}
    <div className="question-form-actions"><button className="question-save-button" disabled={saving}>{saving ? "Сохранение…" : question ? "Сохранить изменения" : "Сохранить вопрос"}</button><button className="question-cancel-button" type="button" onClick={onCancel}>Отмена</button></div>
  </form>;
}
