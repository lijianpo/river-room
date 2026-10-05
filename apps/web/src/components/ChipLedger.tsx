import type { ChipTransactionPage } from '@poker/contracts';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { signedChips, transactionLabel } from '../lib/ledger';

const PAGE_SIZE = 20;

/** 账户筹码流水；可用余额变化（领奖、买入、兑回）时自动刷新。 */
export function ChipLedger({ availableChips }: { availableChips: number }) {
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['transactions'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<ChipTransactionPage>(`/api/account/transactions?limit=${PAGE_SIZE}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (page) => page.nextCursor,
  });
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ['transactions'] });
  }, [availableChips, client]);
  const transactions = query.data?.pages.flatMap((page) => page.transactions) ?? [];
  return (
    <section className="account-card ledger-card">
      <header><span className="account-icon"><ReceiptText /></span><div><h2>筹码流水</h2><p>每一笔入账与出账，以及变动后的可用余额。</p></div></header>
      {query.isLoading ? <p className="form-hint">正在读取流水…</p> : query.isError ? <p className="form-message">流水读取失败，请稍后重试</p> : transactions.length === 0 ? <p className="form-hint">还没有筹码变动记录。</p> : (
        <ol className="ledger-list">
          {transactions.map((item) => (
            <li key={item.id}>
              <div><strong>{transactionLabel(item.type)}</strong><small>{new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}{item.note ? ` · ${item.note}` : ''}</small></div>
              <div className="ledger-amount"><b className={item.amount >= 0 ? 'positive' : 'negative'}>{signedChips(item.amount)}</b><small>余额 {item.balanceAfter.toLocaleString('zh-CN')}</small></div>
            </li>
          ))}
        </ol>
      )}
      {query.hasNextPage && <button className="secondary-button ledger-more" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? '加载中…' : '加载更多'}</button>}
    </section>
  );
}
