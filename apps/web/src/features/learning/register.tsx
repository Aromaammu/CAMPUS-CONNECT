import { BATCH_TABS } from '../academics/batchTabs';
import { SESSION_TABS } from '../attendance/SessionPage';
import { MaterialsTab } from './MaterialsTab';
import { MarksTab, ProgressTab } from './ProgressTabs';

/** Phase 5: Materials and Progress tabs on batches; Marks on the class page. */
BATCH_TABS.push({ id: 'materials', label: 'Materials', show: () => true, render: (b) => <MaterialsTab batch={b} /> });
BATCH_TABS.push({ id: 'progress', label: 'Progress', show: (b) => b.viewerRole !== 'student' && (b.isTeacher || b.canTeach), render: (b) => <ProgressTab batch={b} /> });
SESSION_TABS.splice(0, 0, { id: 'marks', label: 'Marks', render: (r) => <MarksTab data={r} /> });
