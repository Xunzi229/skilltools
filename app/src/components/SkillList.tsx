import type { SkillSummary } from "../model/skill";

interface SkillListProps {
  title: string;
  skills: SkillSummary[];
  selectedSkillId: string | null;
  search: string;
  loading: boolean;
  errorMessage: string | null;
  warnings: string[];
  hasScannedSkills: boolean;
  onSearchChange: (value: string) => void;
  onSelect: (skillId: string) => void;
  onRetry: () => void;
}

const providerNames = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
};

export function SkillList({
  title,
  skills,
  selectedSkillId,
  search,
  loading,
  errorMessage,
  warnings,
  hasScannedSkills,
  onSearchChange,
  onSelect,
  onRetry,
}: SkillListProps) {
  let content;

  if (loading) {
    content = <div className="list-state">正在扫描本地 Skill…</div>;
  } else if (errorMessage) {
    content = (
      <div className="list-state error-state" role="alert">
        <strong>扫描失败：{errorMessage}</strong>
        <button type="button" onClick={onRetry}>重试扫描</button>
      </div>
    );
  } else if (!hasScannedSkills) {
    content = (
      <div className="list-state">
        <strong>未扫描到 Skill</strong>
        <span>请确认本地 Skill 目录中已有内容。</span>
      </div>
    );
  } else if (skills.length === 0) {
    content = (
      <div className="list-state">
        <strong>没有匹配结果</strong>
        <span>请调整筛选条件或搜索关键词。</span>
      </div>
    );
  } else {
    content = (
      <ul className="skill-items">
        {skills.map((skill) => (
          <li key={skill.id}>
            <button
              type="button"
              className={`skill-card${selectedSkillId === skill.id ? " is-selected" : ""}`}
              aria-pressed={selectedSkillId === skill.id}
              onClick={() => onSelect(skill.id)}
            >
              <span className="skill-card-top">
                <strong>{skill.name}</strong>
                <span className={`provider-badge provider-${skill.provider}`}>
                  {providerNames[skill.provider]}
                </span>
              </span>
              <span className="skill-description">{skill.description || "暂无描述"}</span>
              <span className={`status-label status-${skill.status}`}>
                <i aria-hidden="true" />
                {skill.status === "active" ? "已启用" : "已暂停"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="skill-list-panel" aria-label="Skill 列表">
      <header className="list-header">
        <div>
          <p className="eyebrow">本地技能</p>
          <h2>{title}</h2>
        </div>
        <span className="result-count">{skills.length} 项</span>
      </header>
      <label className="search-field">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          aria-label="搜索 Skill"
          placeholder="搜索名称或描述"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </label>
      {warnings.length > 0 && (
        <aside className="warning-block scan-warning-block" aria-label="扫描目录警告">
          <strong>部分目录未扫描</strong>
          <ul>
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </aside>
      )}
      <div className="list-content">{content}</div>
    </section>
  );
}
