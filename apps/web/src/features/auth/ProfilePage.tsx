import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema } from '@cc/shared';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Card, DefinitionList, Input, PageHeader, useToast } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { roleLabel, useUser } from '@/lib/auth';
import { ProfileExtras } from './ProfileExtras';

export function ProfilePage() {
  const user = useUser();
  const toast = useToast();
  const f = useForm<z.infer<typeof changePasswordSchema>>({ resolver: zodResolver(changePasswordSchema) });
  const submit = f.handleSubmit(async (v) => {
    try {
      await post('/auth/change-password', v);
      f.reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast('Password changed');
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) Object.entries(e.fieldErrors).forEach(([k, m]) => f.setError(k as never, { message: m }));
      else toast((e as Error).message, 'bad');
    }
  });
  return (
    <>
      <PageHeader title="My profile" subtitle="Your details and password" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Details">
          <DefinitionList items={[['Name', user.name], ['Role', roleLabel(user)], ['Email', user.email], ['Mobile', user.mobile]]} />
          <p className="help mt-4">To change your name, email or mobile number, contact your branch.</p>
        </Card>
        <Card title="Change password">
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <Input label="Current password" type="password" autoComplete="current-password" {...f.register('currentPassword')} error={f.formState.errors.currentPassword?.message} />
            <Input label="New password" type="password" autoComplete="new-password" help="At least 8 characters with letters and a number" {...f.register('newPassword')} error={f.formState.errors.newPassword?.message} />
            <Input label="Type it again" type="password" autoComplete="new-password" {...f.register('confirmPassword')} error={f.formState.errors.confirmPassword?.message} />
            <div><Button type="submit" loading={f.formState.isSubmitting}>Change password</Button></div>
          </form>
        </Card>
        <ProfileExtras />
      </div>
    </>
  );
}
