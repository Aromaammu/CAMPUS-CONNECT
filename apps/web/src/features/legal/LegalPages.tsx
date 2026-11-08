import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/app/Shell';
import { useBrand } from '@/lib/brand';

function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="min-h-full bg-bg py-10" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left))', paddingRight: 'max(16px, env(safe-area-inset-right))' }}>
      <article className="mx-auto max-w-[72ch]">
        <Link to="/" className="mb-8 inline-block"><Logo /></Link>
        <h1 className="text-[28px] font-bold">{title}</h1>
        <p className="mt-1 text-[13.5px] text-muted">Last updated {updated} · Version 2026-11</p>
        <div className="legal mt-6 grid gap-5 text-[15.5px] leading-relaxed [&_h2]:mt-3 [&_h2]:text-[18px] [&_h2]:font-bold [&_li]:ml-5 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-1">{children}</div>
      </article>
    </div>
  );
}

export function PrivacyPage() {
  const b = useBrand();
  return (
    <LegalLayout title="Privacy Policy" updated="08-11-2026">
      <p>{b.legalName || b.name} ("we") runs {b.name}, the learning platform used by our institute and its franchise branches. This notice explains what personal data we process and why, as required by the Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025.</p>
      <h2>1. Data we collect</h2>
      <ul>
        <li><b>Identity and contact:</b> name, email, mobile number, address, date of birth, guardian name and phone, photo and ID proof if you provide them.</li>
        <li><b>Learning records:</b> courses, batches, attendance (including the time you spent in live classes), performance marks, feedback and final projects.</li>
        <li><b>Live classes:</b> your video, audio, screen shares, chat messages and poll answers during classes, and class recordings.</li>
        <li><b>Payments:</b> fee plans, payments recorded by our staff, receipts and dues. We do not collect card or bank login details.</li>
        <li><b>Messages and help desk:</b> chats with teachers and staff and the tickets you raise.</li>
        <li><b>Technical:</b> log-in times, device and browser type and IP address, used for security.</li>
      </ul>
      <h2>2. Why we use it</h2>
      <ul>
        <li>To run your classes, take attendance, record sessions for your batch and give feedback.</li>
        <li>To manage fees and issue receipts.</li>
        <li>To let you talk to your teachers and branch, and to keep those conversations safe. Authorised staff may review chats that involve students.</li>
        <li>To send notices about classes, fees and your account by in-app notification, email, SMS and browser push.</li>
        <li>To monitor teaching quality and branch performance in summarised form.</li>
      </ul>
      <h2>3. Consent and children</h2>
      <p>We ask for your consent when you first log in. If you are under 18, a parent or guardian must also consent. You can withdraw consent at any time by contacting the Grievance Officer. Some services (classes, attendance, fees) cannot continue without it.</p>
      <h2>4. Who can see your data</h2>
      <p>Your teachers, your branch's staff and authorised head-office staff, each limited to what their role needs. Our hosting, email and SMS providers process data on our behalf under contract. Everything is stored in India. We never sell personal data.</p>
      <h2>5. How long we keep it</h2>
      <ul>
        <li>Class recordings: 180 days, then deleted.</li>
        <li>Attendance, results and fee records: as long as needed for certificates, audits and the law (normally 8 years after your course).</li>
        <li>Chats and help desk tickets: 2 years after your last course.</li>
      </ul>
      <h2>6. Your rights</h2>
      <p>You may ask to see, correct or erase your data, or nominate someone to act for you. Records we must keep by law (such as fee receipts) are kept even after an erasure request. We will answer within 30 days.</p>
      <h2>7. Security</h2>
      <p>We protect data with encrypted connections, hashed passwords, role-based access and a permanent audit log of important actions. If a breach affects you, we will tell you and the Data Protection Board as the law requires.</p>
      <h2>8. Grievance Officer</h2>
      <p>{b.grievanceOfficer || 'Grievance Officer'}{b.grievanceEmail ? ` · ${b.grievanceEmail}` : ''}<br />{b.address}</p>
    </LegalLayout>
  );
}

export function TermsPage() {
  const b = useBrand();
  return (
    <LegalLayout title="Terms of Use" updated="08-11-2026">
      <p>These terms apply to everyone who uses {b.name}: students, teachers, staff and administrators.</p>
      <h2>1. Your account</h2>
      <p>Your branch creates your account. Keep your password private. Do not share your login: the app disconnects a second device that joins the same class.</p>
      <h2>2. Live classes and recordings</h2>
      <ul>
        <li>Classes may be recorded for students of your batch. Recordings are for your own study. Do not download, re-record or share them.</li>
        <li>Behave in class as you would in a classroom. Teachers can mute, remove or restrict participants.</li>
      </ul>
      <h2>3. Messages</h2>
      <p>Use chat for learning and institute matters only. Harassment, abuse and sharing others' personal data are not allowed. Messages involving students may be reviewed by authorised staff and hidden if they break these terms.</p>
      <h2>4. Materials and projects</h2>
      <p>Course materials belong to the institute and are licensed to you for personal study. Your final project remains yours. You let us store it and show it to your teachers and branch for assessment.</p>
      <h2>5. Fees</h2>
      <p>Fees, instalments and refunds follow your enrolment agreement with your branch. Receipts in the app are the official record of payments recorded by staff.</p>
      <h2>6. Changes and law</h2>
      <p>We may update these terms and will ask you to accept important changes. These terms are governed by the laws of India.</p>
      <p>Questions: {b.supportEmail} {b.supportPhone && `· ${b.supportPhone}`}</p>
    </LegalLayout>
  );
}
