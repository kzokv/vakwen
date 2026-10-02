# AI Connections glossary

**Vakwen User**:
The identity that owns portfolios or receives delegated access to other portfolios.
_Avoid_: Account when referring to a person's identity rather than a brokerage account

**Connected Profile**:
The stable identity of a Vakwen User presented to an AI application. The profile remains the same when that user reconnects or chooses a different accessible portfolio.
_Avoid_: Session, selected portfolio

**AI Connection**:
An independently manageable authorization allowing an AI application to access Vakwen on behalf of a Vakwen User. Multiple connections can represent the same Connected Profile, with their own permissions and validity periods.
_Avoid_: Chat session, brokerage account

**Connection Replacement**:
The user's explicit choice to supersede one selected AI Connection with a newly authorized connection for the same Connected Profile. Other AI Connections remain independent, and the selected connection remains usable until its replacement is ready.
_Avoid_: Replace account, sign out everywhere

**Connection Label**:
The editable name distinguishing an AI Connection from a user's other connections. Changing the label does not change the Connected Profile or the connection's authorization.
_Avoid_: Profile identity, account identity
