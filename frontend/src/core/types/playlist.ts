import type { Book } from './book';
import type { Series } from './series';

export interface Playlist {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  created_at: string;
  updated_at: string;
  book_ids: string[];
  books: Book[];
  items?: PlaylistItem[];
  /** Book total the server reports; the list endpoint only sends the first few
   *  items, so counting `items` there would undercount a playlist. */
  book_count?: number;
}

export interface PlaylistItem {
  item_type: 'book' | 'series';
  item_id: string;
  order: number;
  book?: Book;
  series?: Series;
}
