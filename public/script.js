document.addEventListener('DOMContentLoaded', () => {
    loadVotes();
});

async function loadVotes() {
    fetchFreshVotes();
}

function calculateImpact(voteData) {
    let yea = 0, nay = 0;
    for (const m of voteData) {
        const cast = m.voteCast;

        if (cast == 'Yea') yea ++;
        else if (cast == 'Nay') nay++;
    }

    const total = yea + nay;
    const margin = Math.abs(yea - nay);

    if (total > 200 && margin < 20) return 'high';
    return 'low';
}

async function fetchFreshVotes() {
    const container = document.getElementById('voteList');
    
    try {
        container.innerHTML = '<div class="loading"> Loading votes.. (Approx. 5-10 seconds) </div>';

        const response = await fetch(`/api/votes`);
        const data = await response.json();

        const voteCardsHTML = await Promise.all(
            data.houseRollCallVotes.map(vote => displayVoteDetails(vote))
        );

        container.innerHTML = voteCardsHTML.join('');
        
    } catch (error) {
        console.error('API Error:', error);
        container.innerHTML = '<p>Error loading votes. Please refresh.</p>'
    }
}

async function displayVoteDetails(vote) {
    const { legislationNumber, legislationType, result, rollCallNumber, startDate } = vote;

    let title = 'Procedural Vote';
    let summary = 'No summary available for procedural votes.';
    
    if (legislationType && legislationNumber) {
        try {
            const [titleResponse, summaryResponse] = await Promise.all([
                fetch(`/api/bill?type=${legislationType.toLowerCase()}&number=${legislationNumber}&endpoint=titles`),
                fetch(`/api/bill?type=${legislationType.toLowerCase()}&number=${legislationNumber}&endpoint=summaries`)
            ]);
            
            if (titleResponse.ok && summaryResponse.ok) {
                const titleData = await titleResponse.json();
                const summaryData = await summaryResponse.json();
                
                title = titleData.titles?.find(t => t.titleType === 'Official')?.title
                    || titleData.titles?.[0]?.title
                    || vote.voteQuestion
                    || `${legislationType} ${legislationNumber}`;
                
                summary = summaryData.summaries?.[0]?.text
                    || 'Summary not yet available';
                
                summary = summary.replace(/<[^>]+>/g, '');
            }
        } catch (e) {
            title = `${legislationType} ${legislationNumber}`;
        }
    }
    
    const voteResponse = await fetch(
        `/api/vote-detail?roll=${rollCallNumber}`
    );
    const voteDetails = await voteResponse.json();
    const voteData = voteDetails.houseRollCallVote;
    
    const membersResponse = await fetch(
        `/api/vote-members?roll=${rollCallNumber}`
    );
    const membersData = await membersResponse.json();
    
    const memberVotes = membersData.houseRollCallVoteMemberVotes?.results || [];
    const impact = calculateImpact(memberVotes);
    
    let partyHTML = '';
    if (voteData.votePartyTotal) {
        for (const partyData of voteData.votePartyTotal) {
            const partyType = partyData.party?.type;
            const partyClass = partyType ? partyType.toLowerCase(): 'unknown';

            if (!partyType) {
                console.log('Missing party type for roll call: ', rollCallNumber, partyData);
            }
            const partyMembers = memberVotes.filter(m => m.voteParty === partyType);
            const memberDisplay = partyMembers.map(m => 
                `<span class="member-vote" data-lastname="${m.lastName}">${m.firstName} ${m.lastName} <span class="vote-cast">(${m.voteCast})</span></span>`
            ).join(', ');

            partyHTML += `
                <div class="${partyClass}">
                    <h4>${partyData.party.name}</h4>
                    <p>Yea: ${partyData.yeaTotal || 0}</p>
                    <p>Nay: ${partyData.nayTotal || 0}</p>
                    <p>Not Voting: ${partyData.notVotingTotal || 0}</p>
                    ${memberDisplay ? `<p class="reps">${memberDisplay}</p>` : ''}
                </div>
            `;
        }
    }
    
    return `
        <div class="vote-card" data-roll="${rollCallNumber}" data-members='${JSON.stringify(memberVotes)}'>
            <div class="card-top">
                <h3>${legislationType || 'Motion'} ${legislationNumber || ''}: ${title}</h3>
                <span class="impact-stamp impact-${impact}">Impact: ${impact.toUpperCase()}</span>
            </div>
            <p class="question">${voteData.voteQuestion}</p>
            <p class="date">Date: ${new Date(startDate).toLocaleDateString()}</p>
            <p class="result">Result: ${result}</p>

            ${legislationType && legislationNumber ? `
            <div class="summary">
                <h5>Bill Summary:</h5>
                <p>${summary}</p>
            </div>
            ` : ''}

            <div class="party-breakdown">
                ${partyHTML}
            </div>
        </div>
    `;
}

async function getRepByZip(zip) {
    try {
        const res = await fetch(`/api/my-rep?zip=${zip}`);
        if (!res.ok) return null;
        const data = await res.json();

        if (!data || !data.results[0]) return null;
        const rep = data.results[0];
        return {
            lastName: rep.name.split(' ').pop(),
            firstName: rep.name.split(' ').slice(0, -1).join(' '),
            state: rep.state,
            district: rep.district
        };
    } catch {return null;}
}

function filterCardsByRep(rep) {
    const banner = document.getElementById('filterActive');
    const cards = document.querySelectorAll('.vote-card');
    
    if (!rep) {
        cards.forEach(c => {
            c.style.display = 'block';
            c.classList.remove('filtered-view');
        });
        document.querySelectorAll('.member-vote.my-rep').forEach(el => {
            el.classList.remove('my-rep');
        });
        if (banner) banner.style.display = 'none';
        return;
    }

    if (banner) banner.style.display = 'block';

    cards.forEach(card => {
        try {
            const members = JSON.parse(card.dataset.members || '[]');
            const voted = members.some(m => m.lastName === rep.lastName);

            if (voted) {
                card.style.display = 'block';
                card.classList.add('filtered-view');
                
                const memberVotes = card.querySelectorAll('.member-vote');
                memberVotes.forEach(el => {
                    if (el.dataset.lastname?.toLowerCase().trim() === rep.lastName?.toLowerCase().trim()) {
                        el.classList.add('my-rep');
                    } else {
                        el.classList.remove('my-rep');
                    }
                });
            } else {
                card.style.display = 'none';
            }
        } catch (e) {
            card.style.display = 'none';
        }
    });
}

document.getElementById('zipBtn').addEventListener('click', async () => {
    const zip = document.getElementById('zipInput').value.trim();
    if (!/^\d{5}$/.test(zip)) return alert('5-digit ZIP required');
    const rep = await getRepByZip(zip);
    if (!rep) {alert('Rep not found'); return;}
    filterCardsByRep(rep);
});

document.getElementById('clearBtn').addEventListener('click', ()  => {
    document.getElementById('zipInput').value = '';
    filterCardsByRep(null);
});