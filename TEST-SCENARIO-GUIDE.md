# Nards Catering – Alpha Test Scenario Guide

Use this guide for consistent alpha testing of every module. Record Pass/Fail and notes per scenario.

**Test accounts** (create Manager/Staff from Admin → Users & Settings): Admin `Admin` / `Nards2024`, one Manager, one Staff, one Customer (sign up on the Customer site).
**Conventions:** "Today" = the current date. Business hours = 8:00 AM – 6:00 PM, 30-minute slots. Down payment = 20% of the total.
**Status key:** P = Pass, F = Fail, B = Blocked.

---

## 1. Login and automatic role detection

| ID | Scenario | Steps | Expected result |
|----|----------|-------|-----------------|
| AUTH-01 | No role selection | Open `/login`. | Only Username and Password are shown. No Account Type field. |
| AUTH-02 | Admin login | Sign in as Admin. | Redirected to the Admin portal. |
| AUTH-03 | Manager login | Sign in as a Manager. | Redirected to the Manager portal. |
| AUTH-04 | Staff login | Sign in as Staff. | Redirected to the Staff portal. |
| AUTH-05 | Wrong password | Enter a valid username with a wrong password. | Error message; no redirect. |
| AUTH-06 | Portal protection | While logged in as Staff, open `/admin` and `/manager` directly. | Redirected back to the Staff portal. |
| AUTH-07 | Customer login label | Open the Customer login page. | The button reads **Login** (not "Login with Gmail"). |
| AUTH-08 | Email format error | Customer login/sign-up/forgot-password: type `abc@` and leave the field. | Red message "Enter a valid email address…" under the field; form is not submitted. |

**Acceptance:** Role is never chosen manually; every role lands on its own portal; invalid email formats always show an error.

## 2. Navigation and layout

| ID | Scenario | Steps | Expected result |
|----|----------|-------|-----------------|
| NAV-01 | Sidebar replaces top menu | Log in to any portal. | Left sidebar lists the modules; no top menu bar. |
| NAV-02 | Collapse/expand | Click the hamburger button. | Sidebar collapses to icons and expands again; the choice persists after refresh. |
| NAV-03 | Active highlight | Click several modules. | The current module is highlighted and the page title updates. |
| NAV-04 | Header theme bug | Click the logo/brand and header buttons repeatedly. | The theme never switches between Light and Dark unexpectedly. |
| NAV-05 | Staff header | Log in as Staff. | No back/"Next" arrow, only the sidebar toggle, alerts and the profile button. |
| NAV-06 | Profile popover | Click the profile avatar. | Popover shows My Profile, Change Password and Logout. |
| NAV-07 | Popover actions | Choose each item. | My Profile and Change Password open the profile page (Change Password focuses the field); Logout returns to login. |
| NAV-08 | Mobile drawer | Resize to 390 px wide. | Sidebar becomes an off-canvas drawer opened by the hamburger. |

**Acceptance:** Navigation works on desktop and mobile with no layout breakage or unexpected theme change.

## 3. Bookings (Admin / Manager / Staff)

| ID | Scenario | Steps | Expected result |
|----|----------|-------|-----------------|
| BK-01 | Create booking | Bookings → New Booking; complete all fields; Save. | Booking appears in the table with status Pending. |
| BK-02 | Past date blocked | In the booking form pick yesterday. | Dates before today cannot be chosen; an error appears if typed; save is blocked. |
| BK-03 | Business hours | Enter 11:30 PM, 12:00 AM, 7:00 AM and 6:30 PM. | Each shows "must be within business hours"; midnight is never accepted. |
| BK-04 | Valid slot | Enter 10:00 AM. | Accepted. |
| BK-05 | Taken slot | Create a Pending/Confirmed booking, then another on the same date and time. | Error "time slot is already booked". |
| BK-06 | Guest limit | Choose a package with a maximum (e.g. 100) and enter 150. | Error "allows a maximum of 100 guests"; value is limited; save blocked. |
| BK-07 | Guest hint | Select a package. | Hint shows the package's min and max guests. |
| BK-08 | Auto pricing | Select a package. | Package Price fills in; Total = package price; Down Payment = 20%. |
| BK-09 | Additional request | Enter a request and an additional cost of 1,000. | Total = package price + 1,000; Down Payment recalculates. |
| BK-10 | Email validation | Enter `abc@` in Email. | Inline error; save blocked. Valid email clears the error. |
| BK-11 | Edit booking | Edit an existing booking and save. | Changes persist after refresh, including additional request/cost. |
| BK-12 | Server-side enforcement | Call `PUT /bookings/:id` with guests above the package max (API tool). | 400 error with the guest-limit message. |
| BK-13 | Paid receipt UX | Open a booking that has a payment receipt and is Paid. | Shows a green "✓ Paid" badge with a clear "View receipt" button that opens the receipt image. |
| BK-14 | Unpaid with receipt | Booking with a receipt but not yet paid. | Button reads "Review receipt". |
| BK-15 | Staff button cleanup | Staff → Bookings. | No redundant "Active Bookings" button; Archive toggles to "← Back to Bookings". |
| BK-16 | Status changes | Confirm, complete and cancel bookings. | Status updates; cancellation asks for a reason. |

**Acceptance:** No booking can be saved with a past date, out-of-hours or taken time, invalid email or too many guests; totals are always correct.

## 4. Packages (Menu)

| ID | Scenario | Steps | Expected result |
|----|----------|-------|-----------------|
| PK-01 | Set max guests | Menu → Add/Edit package; set Min 50, Max 150. | Saved; the card shows "Min. 50 guests · Max. 150 guests". |
| PK-02 | No limit | Set Max to 0. | Card shows "No guest limit". |
| PK-03 | Max below min | Min 100, Max 50. | Error; not saved. |
| PK-04 | Customer sees limits | Open the Customer site. | Package cards and dropdown show the maximum. |

## 5. Customer booking form

| ID | Scenario | Steps | Expected result |
|----|----------|-------|-----------------|
| CU-01 | Guests field | Select a package. | Guests field shows the package min/max as a hint. |
| CU-02 | Over the limit | Enter more guests than the max. | Red message; request not submitted. |
| CU-03 | Under the minimum | Enter fewer than the minimum. | Red message; request not submitted. |
| CU-04 | Time restrictions | Enter 12:00 AM or 7:00 PM. | Red message about 8:00 AM – 6:00 PM. |
| CU-05 | Past date | Enter a past date. | Red message; not submitted. |
| CU-06 | Email | Enter an invalid email. | Red message under the field. |
| CU-07 | Event types | Open the Event Type dropdown. | Options come from the Dropdown Library. |
| CU-08 | Successful request | Complete the form correctly. | Confirmation; booking visible to staff, with an alert. |

## 6. Table filters and exports

| ID | Scenario | Steps | Expected result |
|----|----------|-------|-----------------|
| TBL-01 | Column filters | On Bookings, type in a column's filter box. | Rows are filtered by that column; filters combine across columns. |
| TBL-02 | Clear filters | Click Clear filters. | All rows return. |
| TBL-03 | Filters after refresh | Apply a filter, then change data (e.g. confirm a booking). | The filter stays applied to the re-rendered rows. |
| TBL-04 | Export CSV | Click Export CSV on any table. | A `.csv` downloads containing the visible (filtered) rows; opens correctly in Excel. |
| TBL-05 | Export Excel | Click Export Excel. | An `.xlsx` downloads and opens without a repair prompt. |
| TBL-06 | Coverage | Repeat on Bookings, Inventory, Assets, Dishes, Clients, Audit Trail, Login Activity, Users. | Every table has filters, CSV and Excel export; the Actions column is not exported. |

## 7. Reports and sales analytics

| ID | Scenario | Steps | Expected result |
|----|----------|-------|-----------------|
| RPT-01 | Export to Excel | Reports → Export to Excel. | One workbook with a sheet per report table; numbers match the screen. |
| RPT-02 | Export PDF | Reports → Export as PDF. | Print preview shows the report only (no sidebar). |
| SA-01 | Labels | Open Sales Analytics. | Filters are labelled "View by", "Week containing", "Year". |
| SA-02 | Weekly / monthly / yearly | Switch each view. | Charts, totals and range label update; only relevant filters are shown. |
| SA-03 | Export CSV / Excel | Click Export CSV and Export Excel. | File contains each period, bookings, sales and a Total row matching the page. |
| SA-04 | Mobile layout | View at 390 px. | Filters stack; no horizontal page scrolling. |

## 8. Roles and permissions (Admin only)

| ID | Scenario | Steps | Expected result |
|----|----------|-------|-----------------|
| RP-01 | View matrix | Admin → Roles & Permissions. | Manager and Staff permission lists load grouped by area. |
| RP-02 | Revoke permission | Untick "Create, edit, confirm, cancel and archive bookings" for Staff; Save. | Success message. Within ~15 s Staff can no longer modify bookings (API returns 403). |
| RP-03 | Menu hidden | Remove "View audit trail" from Manager. | Audit Trail disappears from the Manager sidebar after reload. |
| RP-04 | Grant permission | Re-tick and save. | Access returns. |
| RP-05 | Locked permissions | Look at "admin only" items. | They are disabled and cannot be given to Manager/Staff. |
| RP-06 | Non-admin access | As Manager call `GET /roles`. | 403 Forbidden. |
| RP-07 | Admin unaffected | Remove all permissions from other roles. | Admin keeps full access. |
| RP-08 | Role table | Open the role-management page. | Admin, Manager and Staff appear in a clean selection table with user counts, access counts and status. |
| RP-09 | Add custom role | Click Add role; create Driver with booking/calendar view permissions. | Driver appears as an active custom role with its selected permissions. |
| RP-10 | Edit custom role | Edit Driver's name and description. | The updated role profile appears without changing its role key. |
| RP-11 | Deactivate custom role | Deactivate Driver, then attempt a Driver login. | The role is marked Inactive and assigned users cannot log in until it is activated again. |
| RP-12 | Assign custom role | Create an internal account and choose Driver as its role. | The account receives Driver permissions and the role user count increases. |

## 9. Dropdown library (Admin only)

| ID | Scenario | Steps | Expected result |
|----|----------|-------|-----------------|
| DD-01 | List options | Admin → Dropdown Library; choose "Event Type". | Existing options listed with Active status. |
| DD-02 | Add | Add "Reunion". | Appears in the list and in the booking form / Customer event type dropdown. |
| DD-03 | Duplicate | Add "Reunion" again. | Error; no duplicate. |
| DD-04 | Edit | Rename an option. | New label shown in forms. |
| DD-05 | Deactivate | Deactivate an option. | Hidden from forms, still listed as Inactive. |
| DD-06 | Activate | Activate it again. | Returns to forms. |
| DD-07 | Delete | Delete an option. | Removed everywhere; existing bookings keep their saved value. |
| DD-08 | Other lists | Repeat for Inventory Category, Inventory Unit and Asset Unit. | Inventory and Asset forms reflect the changes. |

## 10. Real-time notifications

| ID | Scenario | Steps | Expected result |
|----|----------|-------|-----------------|
| NT-01 | New booking alert | Submit a booking as a Customer while staff are logged in. | Within ~10 s the ⚡ button shows an unread badge and a toast appears; the bookings list refreshes. |
| NT-02 | Payment receipt | Customer uploads a receipt. | Staff alert "payment receipt". |
| NT-03 | Change request | Customer requests a reschedule/cancel. | Staff alert. |
| NT-04 | Status update | Confirm or cancel a booking. | Relevant roles receive an alert. |
| NT-05 | Permission change | Admin saves role permissions. | Admin receives an alert. |
| NT-06 | Mark all read | Open the panel; Mark all read. | Badge clears and stays cleared after refresh. |
| NT-07 | Role targeting | Check alerts as Staff vs. Admin. | Each user sees only alerts addressed to their role. |

> Alerts use 8-second polling (not WebSockets), so allow up to ~10 seconds.

## 11. Audit trail and login activity

| ID | Scenario | Steps | Expected result |
|----|----------|-------|-----------------|
| AU-01 | Changes logged | Create/edit a booking, change permissions. | Entries appear with user, role, action, time. |
| AU-02 | Alerts not logged | Open and mark alerts read. | No "notifications" audit rows are created. |
| AU-03 | Filter and export | Use the audit filters and export. | Results match the filters. |

## 12. Mobile responsiveness (390 px and 768 px)

| ID | Scenario | Expected result |
|----|----------|-----------------|
| MB-01 | Dashboard | Cards stack; no horizontal page scroll; sales filters usable. |
| MB-02 | Reports | Report sheet and buttons fit; tables scroll within their own container. |
| MB-03 | Audit Trail | Filters stack; table scrolls inside its container. |
| MB-04 | Modals | Booking modal fits the screen and scrolls; fields are tappable. |
| MB-05 | Customer site | Booking form and login pages are usable on mobile. |

---

## Acceptance criteria summary

1. All scenarios above are executed on Admin, Manager, Staff and Customer roles where applicable.
2. No Critical or High defects remain open; Medium defects have an agreed workaround.
3. Role-based access is enforced on the server (API returns 403), not only hidden in the interface.
4. Every table can be filtered by column and exported to CSV and Excel; every report exports to Excel.
5. Booking rules (date, hours, slot, guest limit, pricing, email) are enforced in the interface and by the API.
6. Dropdown and permission changes take effect without code changes or redeployment.
7. Alerts reach the correct roles within ~10 seconds.
8. No unexpected theme switches, console errors or horizontal page scrolling on supported screen sizes.

## Defect log template

| Defect # | Scenario ID | Role | Steps to reproduce | Expected | Actual | Severity | Status |
|----------|-------------|------|--------------------|----------|--------|----------|--------|
