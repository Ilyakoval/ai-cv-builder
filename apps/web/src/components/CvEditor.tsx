'use client';

import { normalizePhone, type CvDocument, type CvEducationItem, type CvExperienceItem, type CvSection } from '@cvb/shared';
import type { ReactNode } from 'react';
import { Button, Field, Input, Textarea, cx } from './ui';

type Update = (fn: (d: CvDocument) => CvDocument) => void;

const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 12)}`;

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function SectionCard({
  id,
  title,
  highlight,
  children,
  action,
}: {
  id: string;
  title: string;
  highlight?: boolean;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cx(
        'scroll-mt-20 rounded-2xl border bg-surface p-4 shadow-sm transition sm:p-6',
        highlight ? 'border-warn/40 ring-2 ring-warn/15' : 'border-line',
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-brand">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ItemToolbar({ index, count, onMove, onRemove, label }: { index: number; count: number; onMove: (to: number) => void; onRemove: () => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" className="min-h-8 px-2" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>
        ↑
      </Button>
      <Button variant="ghost" className="min-h-8 px-2" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
        ↓
      </Button>
      <Button variant="danger" className="min-h-8 px-2" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

const lines = (v: string) => v.split('\n');

export function CvEditor({
  doc,
  update,
  highlight,
}: {
  doc: CvDocument;
  update: Update;
  /** Sections/items that have open questions get a visual cue. */
  highlight: (section: CvSection, itemId?: string) => boolean;
}) {
  const setContact = (patch: Partial<CvDocument['contact']>) => update((d) => ({ ...d, contact: { ...d.contact, ...patch } }));
  const setExp = (id: string, patch: Partial<CvExperienceItem>) =>
    update((d) => ({ ...d, experience: d.experience.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const setEdu = (id: string, patch: Partial<CvEducationItem>) =>
    update((d) => ({ ...d, education: d.education.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  return (
    <div className="space-y-4">
      <SectionCard id="section-contact" title="Contact" highlight={highlight('contact')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={doc.contact.fullName} maxLength={120} onChange={(e) => setContact({ fullName: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={doc.contact.email} maxLength={200} onChange={(e) => setContact({ email: e.target.value })} />
          </Field>
          <Field
            label="Phone"
            hint="For example +380 67 123 45 67"
            error={doc.contact.phone && normalizePhone(doc.contact.phone) === null ? "Doesn't look like a phone number" : undefined}
          >
            <Input
              type="tel"
              inputMode="tel"
              value={doc.contact.phone}
              maxLength={50}
              onChange={(e) => setContact({ phone: e.target.value.replace(/[^+\d\s().\-\/]/g, '') })}
            />
          </Field>
          <Field label="Location">
            <Input value={doc.contact.location} maxLength={120} onChange={(e) => setContact({ location: e.target.value })} />
          </Field>
        </div>
        <div className="mt-4 space-y-2">
          <span className="block text-xs font-medium uppercase tracking-wide text-muted">Links</span>
          {doc.contact.links.map((link, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[10rem_1fr_auto]">
              <Input
                aria-label="Link label"
                placeholder="GitHub"
                value={link.label}
                maxLength={40}
                className="col-span-2 sm:col-span-1"
                onChange={(e) => setContact({ links: doc.contact.links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)) })}
              />
              <Input
                aria-label="Link URL"
                placeholder="https://github.com/you"
                value={link.url}
                maxLength={300}
                onChange={(e) => setContact({ links: doc.contact.links.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)) })}
              />
              <Button variant="danger" className="px-2" onClick={() => setContact({ links: doc.contact.links.filter((_, j) => j !== i) })}>
                Remove
              </Button>
            </div>
          ))}
          {doc.contact.links.length < 8 && (
            <Button variant="secondary" onClick={() => setContact({ links: [...doc.contact.links, { label: '', url: '' }] })}>
              Add link
            </Button>
          )}
        </div>
      </SectionCard>

      <SectionCard id="section-summary" title="Summary" highlight={highlight('summary')}>
        <Textarea
          rows={4}
          value={doc.summary}
          maxLength={1500}
          aria-label="Summary"
          onChange={(e) => update((d) => ({ ...d, summary: e.target.value }))}
        />
      </SectionCard>

      <SectionCard
        id="section-experience"
        title="Experience"
        highlight={highlight('experience')}
        action={
          doc.experience.length < 20 && (
            <Button
              variant="secondary"
              onClick={() =>
                update((d) => ({
                  ...d,
                  experience: [...d.experience, { id: newId('exp'), title: '', company: '', location: '', startDate: '', endDate: '', bullets: [] }],
                }))
              }
            >
              Add role
            </Button>
          )
        }
      >
        {doc.experience.length === 0 && <p className="text-sm text-muted">No experience yet.</p>}
        <div className="space-y-6">
          {doc.experience.map((e, i) => (
            <article
              key={e.id}
              id={`item-${e.id}`}
              className={cx('scroll-mt-20 rounded-lg border p-3 sm:p-4', highlight('experience', e.id) ? 'border-warn/40 bg-warn-soft/50' : 'border-line')}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{[e.title, e.company].filter(Boolean).join(' · ') || `Role ${i + 1}`}</span>
                <ItemToolbar
                  index={i}
                  count={doc.experience.length}
                  label="role"
                  onMove={(to) => update((d) => ({ ...d, experience: move(d.experience, i, to) }))}
                  onRemove={() => update((d) => ({ ...d, experience: d.experience.filter((x) => x.id !== e.id) }))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Job title">
                  <Input value={e.title} maxLength={120} onChange={(ev) => setExp(e.id, { title: ev.target.value })} />
                </Field>
                <Field label="Company">
                  <Input value={e.company} maxLength={120} onChange={(ev) => setExp(e.id, { company: ev.target.value })} />
                </Field>
                <Field label="Start">
                  <Input value={e.startDate} maxLength={30} placeholder="2021-03" onChange={(ev) => setExp(e.id, { startDate: ev.target.value })} />
                </Field>
                <Field label="End">
                  <Input value={e.endDate} maxLength={30} placeholder="Present" onChange={(ev) => setExp(e.id, { endDate: ev.target.value })} />
                </Field>
                <Field label="Location" className="sm:col-span-2">
                  <Input value={e.location} maxLength={120} onChange={(ev) => setExp(e.id, { location: ev.target.value })} />
                </Field>
                <Field label="Achievements" hint="One bullet per line" className="sm:col-span-2">
                  <Textarea rows={Math.max(3, e.bullets.length + 1)} value={e.bullets.join('\n')} onChange={(ev) => setExp(e.id, { bullets: lines(ev.target.value) })} />
                </Field>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        id="section-education"
        title="Education"
        highlight={highlight('education')}
        action={
          doc.education.length < 10 && (
            <Button
              variant="secondary"
              onClick={() =>
                update((d) => ({
                  ...d,
                  education: [...d.education, { id: newId('edu'), institution: '', degree: '', field: '', startDate: '', endDate: '', details: [] }],
                }))
              }
            >
              Add education
            </Button>
          )
        }
      >
        {doc.education.length === 0 && <p className="text-sm text-muted">No education yet.</p>}
        <div className="space-y-6">
          {doc.education.map((e, i) => (
            <article
              key={e.id}
              id={`item-${e.id}`}
              className={cx('scroll-mt-20 rounded-lg border p-3 sm:p-4', highlight('education', e.id) ? 'border-warn/40 bg-warn-soft/50' : 'border-line')}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{e.institution || `Education ${i + 1}`}</span>
                <ItemToolbar
                  index={i}
                  count={doc.education.length}
                  label="education"
                  onMove={(to) => update((d) => ({ ...d, education: move(d.education, i, to) }))}
                  onRemove={() => update((d) => ({ ...d, education: d.education.filter((x) => x.id !== e.id) }))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Institution" className="sm:col-span-2">
                  <Input value={e.institution} maxLength={160} onChange={(ev) => setEdu(e.id, { institution: ev.target.value })} />
                </Field>
                <Field label="Degree">
                  <Input value={e.degree} maxLength={160} onChange={(ev) => setEdu(e.id, { degree: ev.target.value })} />
                </Field>
                <Field label="Field of study">
                  <Input value={e.field} maxLength={160} onChange={(ev) => setEdu(e.id, { field: ev.target.value })} />
                </Field>
                <Field label="Start">
                  <Input value={e.startDate} maxLength={30} onChange={(ev) => setEdu(e.id, { startDate: ev.target.value })} />
                </Field>
                <Field label="End">
                  <Input value={e.endDate} maxLength={30} onChange={(ev) => setEdu(e.id, { endDate: ev.target.value })} />
                </Field>
                <Field label="Details" hint="One per line (optional)" className="sm:col-span-2">
                  <Textarea rows={Math.max(2, e.details.length + 1)} value={e.details.join('\n')} onChange={(ev) => setEdu(e.id, { details: lines(ev.target.value) })} />
                </Field>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        id="section-skills"
        title="Skills"
        highlight={highlight('skills')}
        action={
          doc.skills.length < 12 && (
            <Button variant="secondary" onClick={() => update((d) => ({ ...d, skills: [...d.skills, { id: newId('skl'), name: '', items: [] }] }))}>
              Add group
            </Button>
          )
        }
      >
        {doc.skills.length === 0 && <p className="text-sm text-muted">No skills yet.</p>}
        <div className="space-y-3">
          {doc.skills.map((g) => (
            <div key={g.id} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
              <Input
                aria-label="Skill group"
                placeholder="Languages"
                value={g.name}
                maxLength={60}
                onChange={(e) => update((d) => ({ ...d, skills: d.skills.map((x) => (x.id === g.id ? { ...x, name: e.target.value } : x)) }))}
              />
              <Input
                aria-label="Skills, comma separated"
                placeholder="TypeScript, Go, SQL"
                value={g.items.join(', ')}
                onChange={(e) =>
                  update((d) => ({
                    ...d,
                    skills: d.skills.map((x) => (x.id === g.id ? { ...x, items: e.target.value.split(',').map((s) => s.trimStart()) } : x)),
                  }))
                }
              />
              <Button variant="danger" className="justify-self-start px-2" onClick={() => update((d) => ({ ...d, skills: d.skills.filter((x) => x.id !== g.id) }))}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
