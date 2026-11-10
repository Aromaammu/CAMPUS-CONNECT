# Demo logins

Open http://localhost:5173 and log in with the email **or** mobile number.
Every password is **`Demo@1234`**.

| Role | Name | Email | Mobile | Note |
|---|---|---|---|---|
| Super Admin (Director) | Dr. Thomas Mathew | `director@demo.cc` | 9000000001 |  |
| Admin: Academics + People | Asha Raman | `academics@demo.cc` | 9000000002 |  |
| Head of Accounts | Suresh Iyer | `accounts@demo.cc` | 9000000003 |  |
| Admin: Monitoring, Communication, Help Desk | Leela George | `monitoring@demo.cc` | 9000000004 |  |
| Admin: Branches + Settings | Vinod Kurian | `ops@demo.cc` | 9000000005 |  |
| Branch Admin – Kochi | Bindu Mohan | `kochi.admin@demo.cc` | 9000000006 |  |
| Teacher – Kochi + Thiruvananthapuram | Anita Joseph | `anita.trainer@demo.cc` | 9000000007 |  |
| Teacher – Kochi | Rahul Menon | `rahul.trainer@demo.cc` | 9000000008 |  |
| Accountant – Kochi | Deepa Varghese | `kochi.accounts@demo.cc` | 9000000009 |  |
| Counsellor – Kochi | Faisal Rahman | `kochi.counsellor@demo.cc` | 9000000010 |  |
| Branch Admin – Thiruvananthapuram | Gopika Nair | `tvm.admin@demo.cc` | 9000000011 |  |
| Teacher – Thiruvananthapuram | Sanjay Pillai | `sanjay.trainer@demo.cc` | 9000000012 |  |
| Accountant – Thiruvananthapuram | Liji Thomas | `tvm.accounts@demo.cc` | 9000000013 |  |
| Branch Admin – Bengaluru | Karthik Rao | `blr.admin@demo.cc` | 9000000014 |  |
| Teacher – Bengaluru | Priya Shetty | `priya.trainer@demo.cc` | 9000000015 |  |
| Front Office – Kochi (first login) | Neethu Paul | `new.staff@demo.cc` | 9000000016 | Must set a new password on first login |
| Student – Kochi (enrolled in 2 branches) | Arjun Nair | `arjun.student@demo.cc` | 9000000017 |  |
| Student – Kochi | Diya Menon | `diya.student@demo.cc` | 9000000018 |  |
| Student – Kochi (first login, under 18) | Kevin Mathew | `new.student@demo.cc` | 9000000019 | Must set a password and give guardian consent |

The test mailbox (every email and SMS the app would send) is at http://localhost:5173/dev/mailbox.

## Try a live class

1. Open http://localhost:5173/dev/mailbox and press **Start the demo class now** (moves the Kochi *Live Demo Class* to right now).
2. Log in as `anita.trainer@demo.cc` (teacher), open the class from the dashboard and press **Start class**.
3. In a second browser or a private window, log in as `arjun.student@demo.cc` or `diya.student@demo.cc` and press **Join class**.
4. To see a refusal, try `sanjay.trainer@demo.cc` (a teacher in another branch). To observe silently, use `academics@demo.cc`.

## Attendance and recordings

- **Student:** `arjun.student@demo.cc` → *Attendance* shows his percentage; he missed his latest Morning Batch A class, so he can press **Request attendance** (if it was within 3 days).
- **Teacher:** `anita.trainer@demo.cc` → *Attendance requests* to approve; open any past class from *My batches* → **Attendance** for the sheet.
- **Branch Admin:** `kochi.admin@demo.cc` → *Attendance* (requests, by batch, low attendance) and *Recordings* (rename, hide, replace, delete, restore).
- **Recordings:** Morning Batch A → *Recordings* tab. On this computer recordings use a sample video; real recording runs on the Linux server.
